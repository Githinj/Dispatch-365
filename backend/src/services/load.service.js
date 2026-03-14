const { prisma } = require("./prisma.service");

// ── Load number generation ────────────────────────────────────────────

/**
 * Must be called inside a Prisma transaction (`tx`).
 * Uses the latest loadNumber for the current year to derive the next sequence.
 * The @unique constraint on loadNumber is the final safety net against races.
 */
async function generateLoadNumber(tx) {
  const year = new Date().getFullYear();
  const latest = await tx.load.findFirst({
    where: { loadNumber: { startsWith: `LOAD-${year}-` } },
    orderBy: { loadNumber: "desc" },
    select: { loadNumber: true },
  });

  let seq = 1;
  if (latest?.loadNumber) {
    const parts = latest.loadNumber.split("-");
    seq = parseInt(parts[2], 10) + 1;
  }

  return `LOAD-${year}-${String(seq).padStart(4, "0")}`;
}

// ── Assignment validation ─────────────────────────────────────────────

/**
 * Runs all 7 pre-assignment checks.
 * Returns `{ agencyFleet }` on success or an error string on failure.
 */
async function validateAssignment({ agencyId, fleetId, driverId, vehicleId }) {
  // 1. Fleet ACTIVE
  const fleet = await prisma.fleet.findUnique({ where: { id: fleetId } });
  if (!fleet) return "Fleet not found.";
  if (fleet.status !== "ACTIVE") return `Fleet is not active (status: ${fleet.status}).`;

  // 2. Driver ACTIVE
  const driver = await prisma.user.findFirst({ where: { id: driverId, role: "Driver" } });
  if (!driver) return "Driver not found.";
  if (driver.driverStatus !== "ACTIVE") return `Driver is not available (status: ${driver.driverStatus}).`;

  // 3. Driver belongs to fleet
  if (driver.fleetId !== fleetId) return "Driver does not belong to the selected fleet.";

  // 4. Vehicle AVAILABLE
  const vehicle = await prisma.vehicle.findUnique({ where: { id: vehicleId } });
  if (!vehicle) return "Vehicle not found.";
  if (vehicle.status !== "AVAILABLE") return `Vehicle is not available (status: ${vehicle.status}).`;

  // 5. Vehicle belongs to fleet
  if (vehicle.fleetId !== fleetId) return "Vehicle does not belong to the selected fleet.";

  // 6. AgencyFleet relationship exists
  const agencyFleet = await prisma.agencyFleet.findFirst({ where: { agencyId, fleetId } });
  if (!agencyFleet) return "No active relationship between this agency and the selected fleet.";

  return { agencyFleet };
}

// ── Create load ───────────────────────────────────────────────────────

async function createLoad({
  dispatcherId,
  agencyId,
  fleetId,
  driverId,
  vehicleId,
  origin,
  destination,
  pickupDate,
  deliveryDate,
  commodity,
  weight,
  notes,
  loadRate,
}) {
  // 7. Dispatcher ACTIVE and belongs to agency
  const dispatcher = await prisma.user.findFirst({
    where: { id: dispatcherId, role: "Dispatcher", dispatcherStatus: "ACTIVE" },
  });
  if (!dispatcher) return { error: "Dispatcher not found or not active." };
  if (dispatcher.agencyId !== agencyId) return { error: "Dispatcher does not belong to this agency." };

  const isAssigning = !!(fleetId && driverId && vehicleId);
  let commissionPercent = 0;

  if (isAssigning) {
    const validation = await validateAssignment({ agencyId, fleetId, driverId, vehicleId });
    if (typeof validation === "string") return { error: validation };
    commissionPercent = validation.agencyFleet.commissionPercent;
  }

  const status = isAssigning ? "ASSIGNED" : "DRAFT";
  const commissionAmount = loadRate ? (loadRate * commissionPercent) / 100 : 0;
  const dispatcherEarnings = 0; // future: configurable per dispatcher
  const fleetEarnings = loadRate ? loadRate - commissionAmount - dispatcherEarnings : 0;
  const platformRevenue = commissionAmount;

  const load = await prisma.$transaction(async (tx) => {
    const loadNumber = await generateLoadNumber(tx);

    const newLoad = await tx.load.create({
      data: {
        loadNumber,
        agencyId,
        dispatcherId,
        fleetId: fleetId || null,
        driverId: driverId || null,
        vehicleId: vehicleId || null,
        origin,
        destination,
        pickupDate: pickupDate || null,
        deliveryDate: deliveryDate || null,
        commodity: commodity || null,
        weight: weight || null,
        notes: notes || null,
        loadRate: loadRate || null,
        commissionPercent,
        commissionAmount,
        dispatcherEarnings,
        fleetEarnings,
        platformRevenue,
        status,
      },
    });

    await tx.loadStatusHistory.create({
      data: { loadId: newLoad.id, status, changedById: dispatcherId, changedByRole: "Dispatcher" },
    });

    if (isAssigning) {
      await tx.user.update({ where: { id: driverId }, data: { driverStatus: "ON_LOAD" } });
      await tx.vehicle.update({ where: { id: vehicleId }, data: { status: "ON_LOAD" } });
    }

    return newLoad;
  });

  return { load };
}

// ── List loads ────────────────────────────────────────────────────────

async function listLoads({
  isolation,
  role,
  userId,
  status,
  fleetId,
  driverId,
  dispatcherId,
  dateFrom,
  dateTo,
  origin,
  destination,
  page,
  perPage,
  skip,
}) {
  const where = { ...isolation };

  // Role-based scope narrowing (in addition to agency/fleet isolation)
  if (role === "Dispatcher") where.dispatcherId = userId;
  if (role === "Driver") where.driverId = userId;

  // Query filters
  if (status) {
    const statuses = status.split(",").map((s) => s.trim().toUpperCase());
    where.status = { in: statuses };
  }
  if (fleetId && !where.fleetId) where.fleetId = fleetId;
  if (driverId && !where.driverId) where.driverId = driverId;
  if (dispatcherId && !where.dispatcherId) where.dispatcherId = dispatcherId;

  if (dateFrom || dateTo) {
    where.createdAt = {};
    if (dateFrom) where.createdAt.gte = new Date(dateFrom);
    if (dateTo) where.createdAt.lte = new Date(dateTo);
  }
  if (origin) where.origin = { contains: origin, mode: "insensitive" };
  if (destination) where.destination = { contains: destination, mode: "insensitive" };

  const [data, total] = await Promise.all([
    prisma.load.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        loadNumber: true,
        status: true,
        origin: true,
        destination: true,
        pickupDate: true,
        deliveryDate: true,
        loadRate: true,
        commissionPercent: true,
        commissionAmount: true,
        dispatcherEarnings: true,
        fleetEarnings: true,
        platformRevenue: true,
        fleetId: true,
        driverId: true,
        vehicleId: true,
        dispatcherId: true,
        agencyId: true,
        podUrl: true,
        cancelledAt: true,
        cancellationReason: true,
        completedAt: true,
        createdAt: true,
        driver: { select: { id: true, firstName: true, lastName: true } },
        fleet: { select: { id: true, name: true } },
        vehicle: { select: { id: true, make: true, model: true, plateNumber: true } },
        dispatcher: { select: { id: true, firstName: true, lastName: true } },
      },
    }),
    prisma.load.count({ where }),
  ]);

  return { data, total, page, perPage };
}

// ── Get load by ID ────────────────────────────────────────────────────

async function getLoadById(id) {
  return prisma.load.findUnique({
    where: { id },
    include: {
      driver: { select: { id: true, firstName: true, lastName: true, phone: true } },
      fleet: { select: { id: true, name: true } },
      vehicle: {
        select: { id: true, make: true, model: true, year: true, plateNumber: true, vehicleType: true },
      },
      dispatcher: { select: { id: true, firstName: true, lastName: true, email: true } },
      agency: { select: { id: true, name: true } },
      statusHistory: { orderBy: { createdAt: "asc" } },
      invoices: { select: { id: true, status: true, amount: true, dueDate: true, paidAt: true } },
    },
  });
}

// ── Update DRAFT load ─────────────────────────────────────────────────

async function updateDraftLoad(loadId, dispatcherId, updates) {
  const load = await prisma.load.findFirst({ where: { id: loadId, dispatcherId, status: "DRAFT" } });
  if (!load) return null;

  // Determine what the full assignment state will look like after this update
  const newFleetId = updates.fleetId ?? load.fleetId;
  const newDriverId = updates.driverId ?? load.driverId;
  const newVehicleId = updates.vehicleId ?? load.vehicleId;
  const isFullyAssigning = !!(newFleetId && newDriverId && newVehicleId);

  let commissionPercent = load.commissionPercent || 0;
  let newStatus = "DRAFT";

  if (isFullyAssigning) {
    const validation = await validateAssignment({
      agencyId: load.agencyId,
      fleetId: newFleetId,
      driverId: newDriverId,
      vehicleId: newVehicleId,
    });
    if (typeof validation === "string") return { error: validation };
    commissionPercent = validation.agencyFleet.commissionPercent;
    newStatus = "ASSIGNED";
  }

  const loadRate = updates.loadRate ?? load.loadRate;
  const commissionAmount = loadRate ? (loadRate * commissionPercent) / 100 : 0;
  const dispatcherEarnings = 0;
  const fleetEarnings = loadRate ? loadRate - commissionAmount - dispatcherEarnings : 0;

  const updated = await prisma.$transaction(async (tx) => {
    const result = await tx.load.update({
      where: { id: loadId },
      data: {
        ...updates,
        status: newStatus,
        commissionPercent,
        commissionAmount,
        dispatcherEarnings,
        fleetEarnings,
        platformRevenue: commissionAmount,
      },
    });

    // Write history only on the transition to ASSIGNED
    if (newStatus === "ASSIGNED" && load.status === "DRAFT") {
      await tx.loadStatusHistory.create({
        data: {
          loadId,
          status: "ASSIGNED",
          changedById: dispatcherId,
          changedByRole: "Dispatcher",
        },
      });
      await tx.user.update({ where: { id: newDriverId }, data: { driverStatus: "ON_LOAD" } });
      await tx.vehicle.update({ where: { id: newVehicleId }, data: { status: "ON_LOAD" } });
    }

    return result;
  });

  return { load: updated };
}

// ── Dispatcher blocking loads (for transfer check) ────────────────────

const DISPATCHER_BLOCKING_STATUSES = ["DRAFT", "ASSIGNED", "IN_TRANSIT"];
const DISPATCHER_BLOCKING_INSTRUCTIONS = {
  DRAFT: "Complete the load details and assign a fleet, or cancel it",
  ASSIGNED: "Ensure the fleet executes and marks it delivered",
  IN_TRANSIT: "Wait for the driver to complete the delivery",
};

async function getDispatcherBlockingLoads(dispatcherId) {
  const loads = await prisma.load.findMany({
    where: { dispatcherId, status: { in: DISPATCHER_BLOCKING_STATUSES } },
    select: { id: true, loadNumber: true, status: true, origin: true, destination: true },
  });
  return loads.map((l) => ({ ...l, instruction: DISPATCHER_BLOCKING_INSTRUCTIONS[l.status] }));
}

// ── Status history ────────────────────────────────────────────────────

async function getStatusHistory(loadId) {
  return prisma.loadStatusHistory.findMany({
    where: { loadId },
    orderBy: { createdAt: "asc" },
  });
}

module.exports = {
  createLoad,
  listLoads,
  getLoadById,
  updateDraftLoad,
  getDispatcherBlockingLoads,
  getStatusHistory,
  validateAssignment,
};
