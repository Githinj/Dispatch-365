const { prisma } = require("./prisma.service");
const { updateDispatcherStats } = require("./dispatcher.service");
const { updateDriverStats } = require("./driver.service");

// ── Write status history (must be called inside a tx) ─────────────────

async function writeHistory(tx, { loadId, status, changedById, changedByRole, reason }) {
  return tx.loadStatusHistory.create({
    data: {
      loadId,
      status,
      changedById: changedById || null,
      changedByRole: changedByRole || null,
      reason: reason || null,
    },
  });
}

// ── Start trip (Driver action) ────────────────────────────────────────

async function startTrip(loadId, driverId) {
  const load = await prisma.load.findFirst({
    where: { id: loadId, driverId, status: "ASSIGNED" },
  });
  if (!load) return { error: "Load not found or not in ASSIGNED status." };

  // Can only start on or after pickupDate
  if (load.pickupDate && new Date() < new Date(load.pickupDate)) {
    const dateStr = new Date(load.pickupDate).toISOString().split("T")[0];
    return { error: `Cannot start trip before pickup date (${dateStr}).` };
  }

  await prisma.$transaction(async (tx) => {
    await tx.load.update({
      where: { id: loadId },
      data: { status: "IN_TRANSIT", tripStartedAt: new Date() },
    });
    await writeHistory(tx, { loadId, status: "IN_TRANSIT", changedById: driverId, changedByRole: "Driver" });
  });

  // TODO: Push notification → dispatcher and fleet admin
  // notifyDispatcher(load.dispatcherId, `Driver has started trip for Load #${load.loadNumber}`);
  console.log(`[Notify] Dispatcher ${load.dispatcherId}: Load #${load.loadNumber} trip started.`);
  console.log(`[Notify] Fleet Admin (fleet ${load.fleetId}): Load #${load.loadNumber} trip started.`);

  return { success: true };
}

// ── Mark delivered (Driver action) ────────────────────────────────────

async function markDelivered(loadId, driverId, podUrl) {
  if (!podUrl) return { error: "POD file is required before marking as delivered." };

  const load = await prisma.load.findFirst({
    where: { id: loadId, driverId, status: "IN_TRANSIT" },
  });
  if (!load) return { error: "Load not found or not IN_TRANSIT." };

  await prisma.$transaction(async (tx) => {
    await tx.load.update({
      where: { id: loadId },
      data: {
        status: "PENDING_DELIVERY_CONFIRMATION",
        podUrl,
        deliverySubmittedAt: new Date(),
      },
    });
    await writeHistory(tx, {
      loadId,
      status: "PENDING_DELIVERY_CONFIRMATION",
      changedById: driverId,
      changedByRole: "Driver",
    });
  });

  // TODO: Push notification → dispatcher who created the load
  // notifyDispatcher(load.dispatcherId, `Driver has marked Load #${load.loadNumber} as delivered. Review and confirm.`);
  console.log(
    `[Notify] Dispatcher ${load.dispatcherId}: Load #${load.loadNumber} marked delivered. Driver: ${driverId}. Review POD.`
  );

  return { success: true };
}

// ── Accept delivery (Dispatcher action) ──────────────────────────────

async function acceptDelivery(loadId, dispatcherId) {
  const load = await prisma.load.findFirst({
    where: { id: loadId, dispatcherId, status: "PENDING_DELIVERY_CONFIRMATION" },
  });
  if (!load) return { error: "Load not found or not awaiting delivery confirmation." };

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    // → DELIVERED
    await tx.load.update({
      where: { id: loadId },
      data: { status: "DELIVERED", deliveryAcceptedAt: now },
    });
    await writeHistory(tx, {
      loadId,
      status: "DELIVERED",
      changedById: dispatcherId,
      changedByRole: "Dispatcher",
    });

    // → COMPLETED immediately (automatic per business rules)
    await tx.load.update({
      where: { id: loadId },
      data: { status: "COMPLETED", completedAt: now },
    });
    await writeHistory(tx, {
      loadId,
      status: "COMPLETED",
      changedById: dispatcherId,
      changedByRole: "Dispatcher",
    });

    // Release driver → ACTIVE
    if (load.driverId) {
      await tx.user.updateMany({
        where: { id: load.driverId, driverStatus: "ON_LOAD" },
        data: { driverStatus: "ACTIVE" },
      });
    }

    // Release vehicle → AVAILABLE
    if (load.vehicleId) {
      await tx.vehicle.updateMany({
        where: { id: load.vehicleId, status: "ON_LOAD" },
        data: { status: "AVAILABLE" },
      });
    }
  });

  // Post-transaction side-effects (non-blocking — failures are logged, not surfaced to caller)

  // Auto-generate invoice
  // TODO: await invoiceService.generateInvoice(loadId);
  console.log(`[Invoice] Auto-generate invoice for load ${loadId}`);

  // Update performance stats
  try {
    await updateDispatcherStats(dispatcherId);
  } catch (err) {
    console.error("[Stats] Failed to update dispatcher stats:", err.message);
  }
  if (load.driverId) {
    try {
      await updateDriverStats(load.driverId);
    } catch (err) {
      console.error("[Stats] Failed to update driver stats:", err.message);
    }
  }

  // Check if dispatcher's transfer is now unblocked
  const remainingBlocking = await prisma.load.count({
    where: {
      dispatcherId,
      status: { in: ["DRAFT", "ASSIGNED", "IN_TRANSIT"] },
    },
  });
  if (remainingBlocking === 0) {
    // TODO: notifyDispatcher(dispatcherId, "All blocking loads resolved. You can now request a transfer.");
    console.log(`[Notify] Dispatcher ${dispatcherId}: Transfer button unlocked (no more blocking loads).`);
  }

  // TODO: Notify all parties (dispatcher, driver, fleet admin, agency admin)
  console.log(`[Notify] Load #${load.loadNumber} completed. Notifying all parties.`);

  return { success: true };
}

// ── Reject delivery (Dispatcher action) ──────────────────────────────

const REJECTION_REASONS = [
  "POD image is unclear",
  "Wrong delivery location",
  "Missing signature on POD",
  "Delivered to wrong person",
  "Other",
];

async function rejectDelivery(loadId, dispatcherId, reason) {
  const load = await prisma.load.findFirst({
    where: { id: loadId, dispatcherId, status: "PENDING_DELIVERY_CONFIRMATION" },
  });
  if (!load) return { error: "Load not found or not awaiting delivery confirmation." };

  await prisma.$transaction(async (tx) => {
    await tx.load.update({
      where: { id: loadId },
      data: {
        status: "IN_TRANSIT",
        deliveryRejectedAt: new Date(),
        deliveryRejectionReason: reason,
        // Clear previous POD so driver must re-upload
        podUrl: null,
        deliverySubmittedAt: null,
      },
    });
    await writeHistory(tx, {
      loadId,
      status: "IN_TRANSIT",
      changedById: dispatcherId,
      changedByRole: "Dispatcher",
      reason,
    });
  });

  // TODO: Push notification → driver on mobile
  // notifyDriver(load.driverId, `Delivery not confirmed. Reason: ${reason}. Re-upload POD.`);
  console.log(`[Notify] Driver ${load.driverId}: Delivery rejected. Reason: ${reason}. Re-upload POD.`);

  return { success: true };
}

// ── Cancel load ───────────────────────────────────────────────────────

const CANCELLABLE_STATUSES = ["DRAFT", "ASSIGNED"];

async function cancelLoad(loadId, userId, userRole, reason) {
  const load = await prisma.load.findUnique({ where: { id: loadId } });
  if (!load) return null;

  if (!CANCELLABLE_STATUSES.includes(load.status)) {
    return {
      error: `Cannot cancel a load with status ${load.status}. Cancellation is only allowed before IN_TRANSIT.`,
    };
  }

  // Dispatchers may only cancel their own loads
  if (userRole === "Dispatcher" && load.dispatcherId !== userId) {
    return { error: "Access denied. You can only cancel loads you created." };
  }

  const now = new Date();

  await prisma.$transaction(async (tx) => {
    await tx.load.update({
      where: { id: loadId },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancelledById: userId,
        cancellationReason: reason,
      },
    });
    await writeHistory(tx, {
      loadId,
      status: "CANCELLED",
      changedById: userId,
      changedByRole: userRole,
      reason,
    });

    // Release driver → ACTIVE (if they were ON_LOAD for this assignment)
    if (load.driverId) {
      await tx.user.updateMany({
        where: { id: load.driverId, driverStatus: "ON_LOAD" },
        data: { driverStatus: "ACTIVE" },
      });
    }

    // Release vehicle → AVAILABLE
    if (load.vehicleId) {
      await tx.vehicle.updateMany({
        where: { id: load.vehicleId, status: "ON_LOAD" },
        data: { status: "AVAILABLE" },
      });
    }
  });

  // Update dispatcher stats (cancelled loads affect completion rate)
  try {
    await updateDispatcherStats(load.dispatcherId);
  } catch (err) {
    console.error("[Stats] Failed to update dispatcher stats:", err.message);
  }

  // TODO: Notify fleet admin and driver
  console.log(`[Notify] Load #${load.loadNumber} cancelled by ${userId}. Notifying fleet admin and driver.`);

  return { success: true };
}

module.exports = {
  startTrip,
  markDelivered,
  acceptDelivery,
  rejectDelivery,
  cancelLoad,
  REJECTION_REASONS,
};
