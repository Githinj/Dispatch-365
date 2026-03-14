const { prisma } = require("./prisma.service");
const { destroySession } = require("./redis.service");

const BLOCKING_STATUSES = ["ASSIGNED", "IN_TRANSIT", "PENDING_DELIVERY_CONFIRMATION"];

// ── Request transfer ──────────────────────────────────────────────────

async function requestTransfer({ driverId, toFleetId }) {
  const driver = await prisma.user.findFirst({
    where: { id: driverId, role: "Driver", driverStatus: "ACTIVE" },
  });
  if (!driver) return { error: "Driver not found or not active." };
  if (!driver.fleetId) return { error: "Driver has no current fleet." };
  if (driver.fleetId === toFleetId) return { error: "Driver is already in this fleet." };

  const toFleet = await prisma.fleet.findUnique({ where: { id: toFleetId } });
  if (!toFleet || toFleet.status !== "ACTIVE") {
    return { error: "Target fleet not found or not active." };
  }

  // Check for existing pending transfer
  const existing = await prisma.driverTransferRequest.findFirst({
    where: { driverId, status: { in: ["PENDING", "PARTIAL"] } },
  });
  if (existing) return { error: "A transfer request is already pending." };

  // Check blocking loads
  const INSTRUCTIONS = {
    ASSIGNED: "Complete the delivery and upload POD",
    IN_TRANSIT: "Complete the delivery and upload POD",
    PENDING_DELIVERY_CONFIRMATION: "Wait for dispatcher to confirm your delivery",
  };

  const blockingLoads = await prisma.load.findMany({
    where: { driverId, status: { in: BLOCKING_STATUSES } },
    select: { id: true, status: true, origin: true, destination: true },
  });

  if (blockingLoads.length > 0) {
    return {
      error: "Transfer blocked by active loads.",
      blockingLoads: blockingLoads.map((l) => ({ ...l, instruction: INSTRUCTIONS[l.status] })),
    };
  }

  const result = await prisma.$transaction(async (tx) => {
    const transfer = await tx.driverTransferRequest.create({
      data: {
        driverId,
        fromFleetId: driver.fleetId,
        toFleetId,
        status: "PENDING",
      },
    });

    await tx.user.update({
      where: { id: driverId },
      data: { driverStatus: "SUSPENDED_TRANSFER", isActive: false },
    });

    return transfer;
  });

  await destroySession(driverId);

  return { transfer: result };
}

// ── Approve transfer ──────────────────────────────────────────────────

async function approveTransfer({ transferId, approvingFleetId }) {
  const transfer = await prisma.driverTransferRequest.findUnique({
    where: { id: transferId },
    include: { driver: true },
  });
  if (!transfer) return null;
  if (!["PENDING", "PARTIAL"].includes(transfer.status)) {
    return { error: "Transfer is not awaiting approval." };
  }

  const isFrom = transfer.fromFleetId === approvingFleetId;
  const isTo = transfer.toFleetId === approvingFleetId;
  if (!isFrom && !isTo) return { error: "Fleet not part of this transfer." };

  const fromApproved = isFrom ? true : transfer.fromFleetApproved;
  const toApproved = isTo ? true : transfer.toFleetApproved;
  const bothApproved = fromApproved === true && toApproved === true;

  if (bothApproved) {
    await prisma.$transaction(async (tx) => {
      await tx.driverTransferRequest.update({
        where: { id: transferId },
        data: { status: "APPROVED", fromFleetApproved: true, toFleetApproved: true },
      });

      // Close old fleet history
      await tx.driverFleetHistory.updateMany({
        where: { driverId: transfer.driverId, endDate: null },
        data: { endDate: new Date() },
      });

      // Open new fleet history
      await tx.driverFleetHistory.create({
        data: { driverId: transfer.driverId, fleetId: transfer.toFleetId },
      });

      // Move driver to new fleet, activate
      await tx.user.update({
        where: { id: transfer.driverId },
        data: {
          fleetId: transfer.toFleetId,
          driverStatus: "ACTIVE",
          isActive: true,
        },
      });
    });

    return { status: "APPROVED", message: "Transfer complete. Driver moved to new fleet." };
  }

  await prisma.driverTransferRequest.update({
    where: { id: transferId },
    data: {
      status: "PARTIAL",
      fromFleetApproved: fromApproved,
      toFleetApproved: toApproved,
    },
  });

  return { status: "PARTIAL", message: "Approval recorded. Waiting for other fleet." };
}

// ── Decline transfer ──────────────────────────────────────────────────

async function declineTransfer({ transferId, decliningFleetId, reason }) {
  const transfer = await prisma.driverTransferRequest.findUnique({ where: { id: transferId } });
  if (!transfer) return null;
  if (!["PENDING", "PARTIAL"].includes(transfer.status)) {
    return { error: "Transfer is not awaiting approval." };
  }

  const isFrom = transfer.fromFleetId === decliningFleetId;
  const isTo = transfer.toFleetId === decliningFleetId;
  if (!isFrom && !isTo) return { error: "Fleet not part of this transfer." };

  await prisma.$transaction(async (tx) => {
    await tx.driverTransferRequest.update({
      where: { id: transferId },
      data: { status: "DECLINED", declineReason: reason },
    });

    await tx.user.update({
      where: { id: transfer.driverId },
      data: { driverStatus: "ACTIVE", isActive: true },
    });
  });

  return { status: "DECLINED", message: "Transfer declined. Driver restored to current fleet." };
}

// ── Cancel transfer (by driver) ───────────────────────────────────────

async function cancelTransfer({ transferId, driverId }) {
  const transfer = await prisma.driverTransferRequest.findUnique({ where: { id: transferId } });
  if (!transfer) return null;
  if (transfer.driverId !== driverId) return { error: "Access denied." };
  if (!["PENDING", "PARTIAL"].includes(transfer.status)) {
    return { error: "Transfer cannot be cancelled at this stage." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.driverTransferRequest.update({
      where: { id: transferId },
      data: { status: "CANCELLED" },
    });

    await tx.user.update({
      where: { id: driverId },
      data: { driverStatus: "SUSPENDED_RESTORATION" },
    });
  });

  return { status: "CANCELLED", message: "Transfer cancelled. Awaiting restoration approval from fleet admin." };
}

// ── Approve restoration ───────────────────────────────────────────────

async function approveRestoration({ driverId, fleetId }) {
  const driver = await prisma.user.findFirst({
    where: { id: driverId, role: "Driver", fleetId, driverStatus: "SUSPENDED_RESTORATION" },
  });
  if (!driver) return null;

  const updated = await prisma.user.update({
    where: { id: driverId },
    data: { driverStatus: "ACTIVE", isActive: true },
  });

  return { driver: updated, message: "Driver restored. They can receive loads again." };
}

// ── Decline restoration ───────────────────────────────────────────────

async function declineRestoration({ driverId, fleetId, reason }) {
  const driver = await prisma.user.findFirst({
    where: { id: driverId, role: "Driver", fleetId, driverStatus: "SUSPENDED_RESTORATION" },
  });
  if (!driver) return null;

  const updated = await prisma.user.update({
    where: { id: driverId },
    data: { driverStatus: "INACTIVE", isActive: false, fleetId: null },
  });

  return { driver: updated, message: "Restoration declined. Driver is now inactive and can request other fleets." };
}

// ── Join request ──────────────────────────────────────────────────────

async function requestJoin({ driverId, fleetId, reasonForLeaving }) {
  const driver = await prisma.user.findFirst({
    where: { id: driverId, role: "Driver", driverStatus: "INACTIVE" },
  });
  if (!driver) return { error: "Driver not found or not inactive." };

  // Only one pending join request at a time
  const existingPending = await prisma.driverJoinRequest.findFirst({
    where: { driverId, status: "PENDING" },
  });
  if (existingPending) {
    return { error: "You already have a pending join request." };
  }

  // 30-day cooldown per fleet
  const recentDeclined = await prisma.driverJoinRequest.findFirst({
    where: {
      driverId,
      fleetId,
      status: "DECLINED",
      cooldownUntil: { gt: new Date() },
    },
  });
  if (recentDeclined) {
    const daysLeft = Math.ceil(
      (recentDeclined.cooldownUntil - new Date()) / (1000 * 60 * 60 * 24)
    );
    return { error: `Cooldown active. You can request this fleet again in ${daysLeft} day(s).` };
  }

  const joinRequest = await prisma.driverJoinRequest.create({
    data: { driverId, fleetId, status: "PENDING", reasonForLeaving: reasonForLeaving || null },
  });

  return { joinRequest };
}

// ── Approve join ──────────────────────────────────────────────────────

async function approveJoin({ joinRequestId, fleetId }) {
  const req = await prisma.driverJoinRequest.findFirst({
    where: { id: joinRequestId, fleetId, status: "PENDING" },
    include: { driver: true },
  });
  if (!req) return null;

  await prisma.$transaction(async (tx) => {
    await tx.driverJoinRequest.update({
      where: { id: joinRequestId },
      data: { status: "APPROVED" },
    });

    await tx.user.update({
      where: { id: req.driverId },
      data: { fleetId, driverStatus: "ACTIVE", isActive: true },
    });

    await tx.driverFleetHistory.create({
      data: { driverId: req.driverId, fleetId },
    });

    await tx.driverStats.upsert({
      where: { driverId: req.driverId },
      create: { driverId: req.driverId },
      update: {},
    });
  });

  return { message: "Join request approved. Driver is now active in your fleet." };
}

// ── Decline join ──────────────────────────────────────────────────────

async function declineJoin({ joinRequestId, fleetId, reason }) {
  const req = await prisma.driverJoinRequest.findFirst({
    where: { id: joinRequestId, fleetId, status: "PENDING" },
  });
  if (!req) return null;

  const cooldownUntil = new Date();
  cooldownUntil.setDate(cooldownUntil.getDate() + 30);

  await prisma.driverJoinRequest.update({
    where: { id: joinRequestId },
    data: { status: "DECLINED", declineReason: reason, cooldownUntil },
  });

  return { message: "Join request declined." };
}

module.exports = {
  requestTransfer,
  approveTransfer,
  declineTransfer,
  cancelTransfer,
  approveRestoration,
  declineRestoration,
  requestJoin,
  approveJoin,
  declineJoin,
};
