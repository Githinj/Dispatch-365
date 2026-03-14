const { prisma } = require("./prisma.service");

// ── Create vehicle ────────────────────────────────────────────────────

async function createVehicle({ fleetId, make, model, year, vehicleType, plateNumber, vin, capacityTons, insuranceExpiry, inspectionExpiry }) {
  const existing = await prisma.vehicle.findFirst({
    where: { OR: [{ plateNumber }, ...(vin ? [{ vin }] : [])] },
  });
  if (existing) return { error: "A vehicle with this plate number or VIN already exists." };

  const vehicle = await prisma.vehicle.create({
    data: {
      fleetId,
      make,
      model,
      year,
      vehicleType,
      plateNumber,
      vin: vin || null,
      capacityTons: capacityTons || null,
      insuranceExpiry: insuranceExpiry || null,
      inspectionExpiry: inspectionExpiry || null,
      status: "AVAILABLE",
      isActive: true,
    },
  });

  return { vehicle };
}

// ── List vehicles (fleet-scoped) ──────────────────────────────────────

async function listVehicles({ fleetId, status, page, perPage, skip }) {
  const where = { fleetId };
  if (status) where.status = status;

  const [data, total] = await Promise.all([
    prisma.vehicle.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        make: true,
        model: true,
        year: true,
        vehicleType: true,
        plateNumber: true,
        vin: true,
        capacityTons: true,
        status: true,
        isActive: true,
        insuranceExpiry: true,
        inspectionExpiry: true,
        insuranceIsExpired: true,
        inspectionIsExpired: true,
        createdAt: true,
      },
    }),
    prisma.vehicle.count({ where }),
  ]);

  return { data, total, page, perPage };
}

// ── Available vehicles (for dispatcher creating a load) ───────────────

async function listAvailableVehicles({ fleetId, page, perPage, skip }) {
  const where = {
    fleetId,
    status: "AVAILABLE",
    isActive: true,
    insuranceIsExpired: false,
    inspectionIsExpired: false,
  };

  const [data, total] = await Promise.all([
    prisma.vehicle.findMany({
      where,
      skip,
      take: perPage,
      orderBy: [{ make: "asc" }, { model: "asc" }],
      select: {
        id: true,
        make: true,
        model: true,
        year: true,
        vehicleType: true,
        plateNumber: true,
        capacityTons: true,
      },
    }),
    prisma.vehicle.count({ where }),
  ]);

  return { data, total, page, perPage };
}

// ── Get vehicle by ID ─────────────────────────────────────────────────

async function getVehicleById(id) {
  return prisma.vehicle.findUnique({
    where: { id },
    select: {
      id: true,
      fleetId: true,
      make: true,
      model: true,
      year: true,
      vehicleType: true,
      plateNumber: true,
      vin: true,
      capacityTons: true,
      status: true,
      isActive: true,
      insuranceExpiry: true,
      inspectionExpiry: true,
      insuranceIsExpired: true,
      inspectionIsExpired: true,
      createdAt: true,
      updatedAt: true,
      maintenanceRecords: {
        orderBy: { createdAt: "desc" },
        take: 10,
      },
    },
  });
}

// ── Update vehicle ────────────────────────────────────────────────────

async function updateVehicle(id, fleetId, updates) {
  const vehicle = await prisma.vehicle.findFirst({ where: { id, fleetId } });
  if (!vehicle) return null;

  return prisma.vehicle.update({ where: { id }, data: updates });
}

// ── Retire vehicle (→ INACTIVE) ───────────────────────────────────────

async function retireVehicle(id, fleetId) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id, fleetId, status: { not: "INACTIVE" } },
  });
  if (!vehicle) return null;
  if (vehicle.status === "ON_LOAD") return { error: "Cannot retire a vehicle that is currently on a load." };

  return prisma.vehicle.update({
    where: { id },
    data: { status: "INACTIVE", isActive: false },
  });
}

// ── ON_LOAD status automation ─────────────────────────────────────────

/** Called when a load is assigned to a vehicle. */
async function setVehicleOnLoad(vehicleId) {
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId, status: "AVAILABLE" },
  });
  if (!vehicle) return { error: "Vehicle is not available for load assignment." };

  return prisma.vehicle.update({
    where: { id: vehicleId },
    data: { status: "ON_LOAD" },
  });
}

/** Called when a load reaches COMPLETED or CANCELLED. */
async function releaseVehicleFromLoad(vehicleId) {
  await prisma.vehicle.updateMany({
    where: { id: vehicleId, status: "ON_LOAD" },
    data: { status: "AVAILABLE" },
  });
}

// ── Cross-fleet validation ────────────────────────────────────────────

/**
 * Ensures vehicle belongs to the given fleet.
 * Returns null on success, error string on failure.
 */
async function validateVehicleFleet(vehicleId, fleetId) {
  if (!vehicleId) return null;
  const vehicle = await prisma.vehicle.findFirst({
    where: { id: vehicleId },
    select: { fleetId: true, status: true, insuranceIsExpired: true, inspectionIsExpired: true },
  });
  if (!vehicle) return "Vehicle not found.";
  if (vehicle.fleetId !== fleetId) return "Vehicle does not belong to the assigned fleet.";
  if (vehicle.status !== "AVAILABLE") return `Vehicle is not available (current status: ${vehicle.status}).`;
  if (vehicle.insuranceIsExpired) return "Vehicle insurance has expired.";
  if (vehicle.inspectionIsExpired) return "Vehicle inspection has expired.";
  return null;
}

// ── Maintenance: start ────────────────────────────────────────────────

async function startMaintenance(vehicleId, fleetId, { type, description, notes, cost, scheduledDate, createdById }) {
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, fleetId } });
  if (!vehicle) return null;
  if (vehicle.status === "ON_LOAD") return { error: "Cannot start maintenance on a vehicle that is currently on a load." };
  if (vehicle.status === "INACTIVE") return { error: "Cannot start maintenance on an inactive vehicle." };

  const result = await prisma.$transaction(async (tx) => {
    const record = await tx.maintenanceRecord.create({
      data: {
        vehicleId,
        type,
        status: "IN_PROGRESS",
        description,
        notes: notes || null,
        cost: cost || null,
        scheduledDate: scheduledDate || null,
        startedAt: new Date(),
        createdById: createdById || null,
      },
    });

    await tx.vehicle.update({
      where: { id: vehicleId },
      data: { status: "UNDER_MAINTENANCE" },
    });

    return record;
  });

  return { record: result };
}

// ── Maintenance: complete ─────────────────────────────────────────────

async function completeMaintenance(vehicleId, fleetId, recordId, { notes, cost }) {
  const vehicle = await prisma.vehicle.findFirst({ where: { id: vehicleId, fleetId } });
  if (!vehicle) return null;

  const record = await prisma.maintenanceRecord.findFirst({
    where: { id: recordId, vehicleId, status: "IN_PROGRESS" },
  });
  if (!record) return { error: "Active maintenance record not found." };

  const result = await prisma.$transaction(async (tx) => {
    const updated = await tx.maintenanceRecord.update({
      where: { id: recordId },
      data: {
        status: "COMPLETED",
        completedAt: new Date(),
        notes: notes || record.notes,
        cost: cost !== undefined ? cost : record.cost,
      },
    });

    // Only restore AVAILABLE if no other IN_PROGRESS records exist
    const remaining = await tx.maintenanceRecord.count({
      where: { vehicleId, status: "IN_PROGRESS", id: { not: recordId } },
    });

    if (remaining === 0) {
      await tx.vehicle.update({
        where: { id: vehicleId },
        data: { status: "AVAILABLE" },
      });
    }

    return updated;
  });

  return { record: result };
}

// ── Maintenance history ───────────────────────────────────────────────

async function getMaintenanceHistory(vehicleId, { page, perPage, skip }) {
  const where = { vehicleId };

  const [data, total] = await Promise.all([
    prisma.maintenanceRecord.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
    }),
    prisma.maintenanceRecord.count({ where }),
  ]);

  return { data, total, page, perPage };
}

// ── Document expiry monitoring ────────────────────────────────────────

async function getExpiringDocuments(withinDays = 30) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + withinDays);

  const vehicles = await prisma.vehicle.findMany({
    where: {
      isActive: true,
      OR: [
        { insuranceExpiry: { lte: cutoff } },
        { inspectionExpiry: { lte: cutoff } },
      ],
    },
    select: {
      id: true,
      fleetId: true,
      make: true,
      model: true,
      year: true,
      plateNumber: true,
      insuranceExpiry: true,
      inspectionExpiry: true,
      insuranceIsExpired: true,
      inspectionIsExpired: true,
    },
  });

  const now = new Date();
  return vehicles.map((v) => ({
    ...v,
    insuranceDaysUntilExpiry: v.insuranceExpiry
      ? Math.ceil((v.insuranceExpiry - now) / (1000 * 60 * 60 * 24))
      : null,
    inspectionDaysUntilExpiry: v.inspectionExpiry
      ? Math.ceil((v.inspectionExpiry - now) / (1000 * 60 * 60 * 24))
      : null,
  }));
}

/** Flag vehicle's insurance as expired. */
async function flagExpiredInsurance(vehicleId) {
  return prisma.vehicle.update({
    where: { id: vehicleId },
    data: { insuranceIsExpired: true },
  });
}

/** Flag vehicle's inspection as expired. */
async function flagExpiredInspection(vehicleId) {
  return prisma.vehicle.update({
    where: { id: vehicleId },
    data: { inspectionIsExpired: true },
  });
}

module.exports = {
  createVehicle,
  listVehicles,
  listAvailableVehicles,
  getVehicleById,
  updateVehicle,
  retireVehicle,
  setVehicleOnLoad,
  releaseVehicleFromLoad,
  validateVehicleFleet,
  startMaintenance,
  completeMaintenance,
  getMaintenanceHistory,
  getExpiringDocuments,
  flagExpiredInsurance,
  flagExpiredInspection,
};
