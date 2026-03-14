const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { prisma } = require("./prisma.service");
const { destroySession } = require("./redis.service");

// ── Invite (Fleet Admin adds driver) ─────────────────────────────────

async function inviteDriver({ email, firstName, lastName, fleetId, agencyId }) {
  const inviteToken = crypto.randomBytes(32).toString("hex");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "A user with this email already exists." };

  const user = await prisma.user.create({
    data: {
      email,
      firstName,
      lastName,
      password: "",      // set on registration
      role: "Driver",
      driverStatus: "PENDING",
      fleetId,
      agencyId: agencyId || null,
      inviteToken,
      isActive: false,
    },
  });

  return { user, inviteToken };
}

// ── Register via invite ──────────────────────────────────────────────

async function registerDriver(inviteToken, data) {
  const user = await prisma.user.findUnique({ where: { inviteToken } });
  if (!user) return { error: "Invalid invite token." };
  if (user.role !== "Driver") return { error: "Invalid invite token." };
  if (!data.licenseUrl) return { error: "Driver license copy is required." };
  if (!data.profilePhotoUrl) return { error: "Profile photo is required." };

  const hashedPassword = await bcrypt.hash(data.password, 10);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      firstName: data.firstName || user.firstName,
      lastName: data.lastName || user.lastName,
      phone: data.phone,
      password: hashedPassword,
      profilePhotoUrl: data.profilePhotoUrl,
      licenseNumber: data.licenseNumber,
      licenseUrl: data.licenseUrl,
      licenseExpiry: data.licenseExpiry,
      medicalCertificateUrl: data.medicalCertificateUrl,
      hazmatCertificationUrl: data.hazmatCertificationUrl,
      backgroundCheckUrl: data.backgroundCheckUrl,
      inviteToken: null,  // consume the token
    },
  });

  return {
    user: {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      driverStatus: updated.driverStatus,
    },
  };
}

// ── List drivers scoped to fleet ──────────────────────────────────────

async function listDrivers({ fleetId, page, perPage, skip, status }) {
  const where = { fleetId, role: "Driver" };
  if (status) where.driverStatus = status;

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        driverStatus: true,
        licenseExpiry: true,
        licenseIsExpired: true,
        isActive: true,
        createdAt: true,
        driverStats: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { data, total, page, perPage };
}

// ── Available drivers (for dispatcher creating a load) ───────────────

async function listAvailableDrivers({ fleetId, page, perPage, skip }) {
  const where = {
    fleetId,
    role: "Driver",
    driverStatus: "ACTIVE",
    isActive: true,
    licenseIsExpired: false,
  };

  const [data, total] = await Promise.all([
    prisma.user.findMany({
      where,
      skip,
      take: perPage,
      orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
      select: {
        id: true,
        firstName: true,
        lastName: true,
        phone: true,
        driverStats: { select: { overallRating: true, totalLoadsCompleted: true } },
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { data, total, page, perPage };
}

// ── Get driver by ID ─────────────────────────────────────────────────

async function getDriverById(id) {
  return prisma.user.findFirst({
    where: { id, role: "Driver" },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      fleetId: true,
      agencyId: true,
      driverStatus: true,
      profilePhotoUrl: true,
      licenseNumber: true,
      licenseUrl: true,
      licenseExpiry: true,
      licenseIsExpired: true,
      medicalCertificateUrl: true,
      hazmatCertificationUrl: true,
      backgroundCheckUrl: true,
      rejectionReason: true,
      isActive: true,
      createdAt: true,
      driverStats: true,
      driverFleetHistory: {
        orderBy: { startDate: "desc" },
        include: { fleet: { select: { id: true, name: true } } },
      },
    },
  });
}

// ── Approve driver ───────────────────────────────────────────────────

async function approveDriver(id, fleetId) {
  const user = await prisma.user.findFirst({
    where: { id, role: "Driver", fleetId, driverStatus: "PENDING" },
  });
  if (!user) return null;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: { driverStatus: "ACTIVE", isActive: true },
    });

    await tx.driverFleetHistory.create({
      data: { driverId: id, fleetId },
    });

    await tx.driverStats.upsert({
      where: { driverId: id },
      create: { driverId: id },
      update: {},
    });

    return updated;
  });
}

// ── Reject driver ────────────────────────────────────────────────────

async function rejectDriver(id, fleetId, reason) {
  const user = await prisma.user.findFirst({
    where: { id, role: "Driver", fleetId, driverStatus: "PENDING" },
  });
  if (!user) return null;

  return prisma.user.update({
    where: { id },
    data: { driverStatus: "INACTIVE", isActive: false, rejectionReason: reason },
  });
}

// ── Suspend driver ───────────────────────────────────────────────────

async function suspendDriver(id, fleetId) {
  const user = await prisma.user.findFirst({
    where: { id, role: "Driver", fleetId, driverStatus: { in: ["ACTIVE", "ON_LOAD"] } },
  });
  if (!user) return null;

  await destroySession(id);

  return prisma.user.update({
    where: { id },
    data: { driverStatus: "SUSPENDED_TRANSFER", isActive: false },
  });
}

// ── ON_LOAD status transitions ───────────────────────────────────────

/** Called when a load is assigned to a driver. */
async function setDriverOnLoad(driverId) {
  const driver = await prisma.user.findFirst({
    where: { id: driverId, role: "Driver", driverStatus: "ACTIVE" },
  });
  if (!driver) return { error: "Driver is not available for load assignment." };

  return prisma.user.update({
    where: { id: driverId },
    data: { driverStatus: "ON_LOAD" },
  });
}

/** Called when a load reaches COMPLETED or CANCELLED. */
async function releaseDriverFromLoad(driverId) {
  await prisma.user.updateMany({
    where: { id: driverId, role: "Driver", driverStatus: "ON_LOAD" },
    data: { driverStatus: "ACTIVE" },
  });
}

// ── Cross-fleet validation ───────────────────────────────────────────

/**
 * Validates that driver and vehicle both belong to the load's fleet.
 * Returns null on success, error string on failure.
 */
async function validateFleetAssignment({ driverId, vehicleId, fleetId }) {
  const [driver, vehicle] = await Promise.all([
    prisma.user.findFirst({ where: { id: driverId, role: "Driver" }, select: { fleetId: true } }),
    vehicleId
      ? prisma.vehicle.findFirst({ where: { id: vehicleId }, select: { fleetId: true } })
      : null,
  ]);

  if (!driver) return "Driver not found.";
  if (driver.fleetId !== fleetId) {
    return `Driver does not belong to the assigned fleet.`;
  }
  if (vehicle && vehicle.fleetId !== fleetId) {
    return `Vehicle does not belong to the assigned fleet.`;
  }

  return null;
}

// ── Blocking loads ───────────────────────────────────────────────────

const DRIVER_BLOCKING_STATUSES = ["ASSIGNED", "IN_TRANSIT", "PENDING_DELIVERY_CONFIRMATION"];

const DRIVER_BLOCKING_INSTRUCTIONS = {
  ASSIGNED: "Complete the delivery and upload POD",
  IN_TRANSIT: "Complete the delivery and upload POD",
  PENDING_DELIVERY_CONFIRMATION: "Wait for dispatcher to confirm your delivery",
};

async function getBlockingLoads(driverId) {
  const loads = await prisma.load.findMany({
    where: { driverId, status: { in: DRIVER_BLOCKING_STATUSES } },
    select: { id: true, status: true, origin: true, destination: true, createdAt: true },
  });

  return loads.map((l) => ({ ...l, instruction: DRIVER_BLOCKING_INSTRUCTIONS[l.status] }));
}

// ── Driver load history ──────────────────────────────────────────────

async function getDriverLoads(driverId, { page, perPage, skip }) {
  const where = { driverId };

  const [data, total] = await Promise.all([
    prisma.load.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        origin: true,
        destination: true,
        pickupDate: true,
        deliveryDate: true,
        completedAt: true,
        podUrl: true,
        agency: { select: { id: true, name: true } },
      },
    }),
    prisma.load.count({ where }),
  ]);

  return { data, total, page, perPage };
}

// ── Performance stats ────────────────────────────────────────────────

async function updateDriverStats(driverId) {
  const loads = await prisma.load.findMany({
    where: { driverId, status: "COMPLETED" },
    select: { deliveryDate: true, completedAt: true, podUrl: true },
  });

  const totalLoadsCompleted = loads.length;

  const onTimeCount = loads.filter(
    (l) => l.deliveryDate && l.completedAt && l.completedAt <= l.deliveryDate
  ).length;
  const onTimeDeliveryRate = totalLoadsCompleted > 0 ? (onTimeCount / totalLoadsCompleted) * 100 : 0;

  const podCount = loads.filter((l) => l.podUrl).length;
  const podAcceptanceRate = totalLoadsCompleted > 0 ? (podCount / totalLoadsCompleted) * 100 : 0;

  const disputedCount = await prisma.invoice.count({
    where: {
      load: { driverId, status: "COMPLETED" },
      status: "DISPUTED",
    },
  });
  const disputeRate = totalLoadsCompleted > 0 ? (disputedCount / totalLoadsCompleted) * 100 : 0;

  // Overall: weighted avg out of 5.0
  // onTime(35%), pod(35%), inverse dispute(30%)
  const overallRating =
    (onTimeDeliveryRate / 100) * 5 * 0.35 +
    (podAcceptanceRate / 100) * 5 * 0.35 +
    ((100 - disputeRate) / 100) * 5 * 0.3;

  return prisma.driverStats.upsert({
    where: { driverId },
    create: {
      driverId,
      totalLoadsCompleted,
      onTimeDeliveryRate: Math.round(onTimeDeliveryRate * 100) / 100,
      podAcceptanceRate: Math.round(podAcceptanceRate * 100) / 100,
      disputeRate: Math.round(disputeRate * 100) / 100,
      overallRating: Math.round(overallRating * 100) / 100,
    },
    update: {
      totalLoadsCompleted,
      onTimeDeliveryRate: Math.round(onTimeDeliveryRate * 100) / 100,
      podAcceptanceRate: Math.round(podAcceptanceRate * 100) / 100,
      disputeRate: Math.round(disputeRate * 100) / 100,
      overallRating: Math.round(overallRating * 100) / 100,
    },
  });
}

async function getPerformanceStats(driverId) {
  return prisma.driverStats.findUnique({ where: { driverId } });
}

// ── License expiry check ─────────────────────────────────────────────

/**
 * Returns drivers whose license is expiring within the given window
 * or already expired. Used for daily cron job.
 */
async function getExpiringLicenses(withinDays = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);

  const drivers = await prisma.user.findMany({
    where: {
      role: "Driver",
      isActive: true,
      licenseExpiry: { lte: cutoff },
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      fleetId: true,
      licenseExpiry: true,
      licenseIsExpired: true,
    },
  });

  const now = new Date();
  return drivers.map((d) => ({
    ...d,
    daysUntilExpiry: d.licenseExpiry
      ? Math.ceil((d.licenseExpiry - now) / (1000 * 60 * 60 * 24))
      : null,
  }));
}

/** Flag driver's license as expired. */
async function flagExpiredLicense(driverId) {
  return prisma.user.update({
    where: { id: driverId },
    data: { licenseIsExpired: true },
  });
}

module.exports = {
  inviteDriver,
  registerDriver,
  listDrivers,
  listAvailableDrivers,
  getDriverById,
  approveDriver,
  rejectDriver,
  suspendDriver,
  setDriverOnLoad,
  releaseDriverFromLoad,
  validateFleetAssignment,
  getBlockingLoads,
  getDriverLoads,
  updateDriverStats,
  getPerformanceStats,
  getExpiringLicenses,
  flagExpiredLicense,
};
