const { prisma } = require("./prisma.service");
const { destroySession } = require("./redis.service");

const BLOCKING_STATUSES = ["DRAFT", "ASSIGNED", "IN_TRANSIT"];

// ── Request transfer ──────────────────────────────────────────────────

async function requestTransfer({ dispatcherId, toAgencyId }) {
  const dispatcher = await prisma.user.findFirst({
    where: { id: dispatcherId, role: "Dispatcher", dispatcherStatus: "ACTIVE" },
  });
  if (!dispatcher) return { error: "Dispatcher not found or not active." };
  if (!dispatcher.agencyId) return { error: "Dispatcher has no current agency." };
  if (dispatcher.agencyId === toAgencyId) {
    return { error: "Dispatcher is already in this agency." };
  }

  const toAgency = await prisma.agency.findUnique({ where: { id: toAgencyId } });
  if (!toAgency || !toAgency.isActive) return { error: "Target agency not found or inactive." };

  // Check for existing pending transfer
  const existing = await prisma.dispatcherTransferRequest.findFirst({
    where: {
      dispatcherId,
      status: { in: ["PENDING", "PARTIAL"] },
    },
  });
  if (existing) return { error: "A transfer request is already pending." };

  // Check blocking loads
  const blockingLoads = await prisma.load.findMany({
    where: { dispatcherId, status: { in: BLOCKING_STATUSES } },
    select: { id: true, status: true, origin: true, destination: true },
  });

  if (blockingLoads.length > 0) {
    const INSTRUCTIONS = {
      DRAFT: "Complete the load details and assign a fleet, or cancel it",
      ASSIGNED: "Ensure the fleet executes and marks it delivered",
      IN_TRANSIT: "Wait for the driver to complete the delivery",
    };
    return {
      error: "Transfer blocked by active loads.",
      blockingLoads: blockingLoads.map((l) => ({
        ...l,
        instruction: INSTRUCTIONS[l.status],
      })),
    };
  }

  // Create transfer request, suspend dispatcher, kill session
  const result = await prisma.$transaction(async (tx) => {
    const transfer = await tx.dispatcherTransferRequest.create({
      data: {
        dispatcherId,
        fromAgencyId: dispatcher.agencyId,
        toAgencyId,
        status: "PENDING",
      },
    });

    await tx.user.update({
      where: { id: dispatcherId },
      data: { dispatcherStatus: "SUSPENDED_TRANSFER", isActive: false },
    });

    return transfer;
  });

  await destroySession(dispatcherId);

  return { transfer: result };
}

// ── Approve transfer ──────────────────────────────────────────────────

async function approveTransfer({ transferId, approvingAgencyId }) {
  const transfer = await prisma.dispatcherTransferRequest.findUnique({
    where: { id: transferId },
    include: { dispatcher: true },
  });
  if (!transfer) return null;
  if (!["PENDING", "PARTIAL"].includes(transfer.status)) {
    return { error: "Transfer is not awaiting approval." };
  }

  const isFrom = transfer.fromAgencyId === approvingAgencyId;
  const isTo = transfer.toAgencyId === approvingAgencyId;
  if (!isFrom && !isTo) return { error: "Agency not part of this transfer." };

  const fromApproved = isFrom ? true : transfer.fromAgencyApproved;
  const toApproved = isTo ? true : transfer.toAgencyApproved;
  const bothApproved = fromApproved === true && toApproved === true;

  if (bothApproved) {
    // Complete the transfer
    await prisma.$transaction(async (tx) => {
      await tx.dispatcherTransferRequest.update({
        where: { id: transferId },
        data: { status: "APPROVED", fromAgencyApproved: true, toAgencyApproved: true },
      });

      // Close old agency history
      await tx.dispatcherAgencyHistory.updateMany({
        where: { dispatcherId: transfer.dispatcherId, endDate: null },
        data: { endDate: new Date() },
      });

      // Open new agency history
      await tx.dispatcherAgencyHistory.create({
        data: { dispatcherId: transfer.dispatcherId, agencyId: transfer.toAgencyId },
      });

      // Update dispatcher to new agency and activate
      await tx.user.update({
        where: { id: transfer.dispatcherId },
        data: {
          agencyId: transfer.toAgencyId,
          dispatcherStatus: "ACTIVE",
          isActive: true,
        },
      });
    });

    return { status: "APPROVED", message: "Transfer complete. Dispatcher moved to new agency." };
  }

  // Only one side approved so far
  await prisma.dispatcherTransferRequest.update({
    where: { id: transferId },
    data: {
      status: "PARTIAL",
      fromAgencyApproved: fromApproved,
      toAgencyApproved: toApproved,
    },
  });

  return { status: "PARTIAL", message: "Approval recorded. Waiting for other agency." };
}

// ── Decline transfer ──────────────────────────────────────────────────

async function declineTransfer({ transferId, decliningAgencyId, reason }) {
  const transfer = await prisma.dispatcherTransferRequest.findUnique({
    where: { id: transferId },
    include: { dispatcher: true },
  });
  if (!transfer) return null;
  if (!["PENDING", "PARTIAL"].includes(transfer.status)) {
    return { error: "Transfer is not awaiting approval." };
  }

  const isFrom = transfer.fromAgencyId === decliningAgencyId;
  const isTo = transfer.toAgencyId === decliningAgencyId;
  if (!isFrom && !isTo) return { error: "Agency not part of this transfer." };

  await prisma.$transaction(async (tx) => {
    await tx.dispatcherTransferRequest.update({
      where: { id: transferId },
      data: { status: "DECLINED", declineReason: reason },
    });

    // Reinstate dispatcher at their original agency
    await tx.user.update({
      where: { id: transfer.dispatcherId },
      data: { dispatcherStatus: "ACTIVE", isActive: true },
    });
  });

  return { status: "DECLINED", message: "Transfer declined. Dispatcher restored to current agency." };
}

// ── Cancel transfer (by dispatcher) ──────────────────────────────────

async function cancelTransfer({ transferId, dispatcherId }) {
  const transfer = await prisma.dispatcherTransferRequest.findUnique({
    where: { id: transferId },
  });
  if (!transfer) return null;
  if (transfer.dispatcherId !== dispatcherId) return { error: "Access denied." };
  if (!["PENDING", "PARTIAL"].includes(transfer.status)) {
    return { error: "Transfer cannot be cancelled at this stage." };
  }

  await prisma.$transaction(async (tx) => {
    await tx.dispatcherTransferRequest.update({
      where: { id: transferId },
      data: { status: "CANCELLED" },
    });

    // Move to SUSPENDED_RESTORATION — requires agency admin to restore
    await tx.user.update({
      where: { id: dispatcherId },
      data: { dispatcherStatus: "SUSPENDED_RESTORATION" },
    });
  });

  return { status: "CANCELLED", message: "Transfer cancelled. Awaiting restoration approval." };
}

// ── Approve restoration ───────────────────────────────────────────────

async function approveRestoration({ dispatcherId, agencyId }) {
  const dispatcher = await prisma.user.findFirst({
    where: {
      id: dispatcherId,
      role: "Dispatcher",
      agencyId,
      dispatcherStatus: "SUSPENDED_RESTORATION",
    },
  });
  if (!dispatcher) return null;

  const updated = await prisma.user.update({
    where: { id: dispatcherId },
    data: { dispatcherStatus: "ACTIVE", isActive: true },
  });

  return { dispatcher: updated, message: "Dispatcher restored. They can create loads again." };
}

// ── Decline restoration ───────────────────────────────────────────────

async function declineRestoration({ dispatcherId, agencyId, reason }) {
  const dispatcher = await prisma.user.findFirst({
    where: {
      id: dispatcherId,
      role: "Dispatcher",
      agencyId,
      dispatcherStatus: "SUSPENDED_RESTORATION",
    },
  });
  if (!dispatcher) return null;

  const updated = await prisma.user.update({
    where: { id: dispatcherId },
    data: { dispatcherStatus: "INACTIVE", isActive: false, agencyId: null },
  });

  return { dispatcher: updated, message: "Restoration declined. Dispatcher is now inactive." };
}

// ── Join request ──────────────────────────────────────────────────────

async function requestJoin({ dispatcherId, agencyId }) {
  const dispatcher = await prisma.user.findFirst({
    where: { id: dispatcherId, role: "Dispatcher", dispatcherStatus: "INACTIVE" },
  });
  if (!dispatcher) return { error: "Dispatcher not found or not inactive." };

  // Only one pending join request at a time
  const existingPending = await prisma.dispatcherJoinRequest.findFirst({
    where: { dispatcherId, status: "PENDING" },
  });
  if (existingPending) {
    return { error: "You already have a pending join request. Cancel it before sending another." };
  }

  // 30-day cooldown check for this specific agency
  const recentDeclined = await prisma.dispatcherJoinRequest.findFirst({
    where: {
      dispatcherId,
      agencyId,
      status: "DECLINED",
      cooldownUntil: { gt: new Date() },
    },
  });
  if (recentDeclined) {
    const daysLeft = Math.ceil(
      (recentDeclined.cooldownUntil - new Date()) / (1000 * 60 * 60 * 24)
    );
    return { error: `Cooldown active. You can request this agency again in ${daysLeft} day(s).` };
  }

  const joinRequest = await prisma.dispatcherJoinRequest.create({
    data: { dispatcherId, agencyId, status: "PENDING" },
  });

  return { joinRequest };
}

// ── Approve join ──────────────────────────────────────────────────────

async function approveJoin({ joinRequestId, agencyId }) {
  const req = await prisma.dispatcherJoinRequest.findFirst({
    where: { id: joinRequestId, agencyId, status: "PENDING" },
    include: { dispatcher: true },
  });
  if (!req) return null;

  await prisma.$transaction(async (tx) => {
    await tx.dispatcherJoinRequest.update({
      where: { id: joinRequestId },
      data: { status: "APPROVED" },
    });

    await tx.user.update({
      where: { id: req.dispatcherId },
      data: {
        agencyId,
        dispatcherStatus: "ACTIVE",
        isActive: true,
      },
    });

    await tx.dispatcherAgencyHistory.create({
      data: { dispatcherId: req.dispatcherId, agencyId },
    });

    await tx.dispatcherStats.upsert({
      where: { dispatcherId: req.dispatcherId },
      create: { dispatcherId: req.dispatcherId },
      update: {},
    });
  });

  return { message: "Join request approved. Dispatcher is now active." };
}

// ── Decline join ──────────────────────────────────────────────────────

async function declineJoin({ joinRequestId, agencyId, reason }) {
  const req = await prisma.dispatcherJoinRequest.findFirst({
    where: { id: joinRequestId, agencyId, status: "PENDING" },
  });
  if (!req) return null;

  const cooldownUntil = new Date();
  cooldownUntil.setDate(cooldownUntil.getDate() + 30);

  await prisma.dispatcherJoinRequest.update({
    where: { id: joinRequestId },
    data: { status: "DECLINED", declineReason: reason, cooldownUntil },
  });

  return { message: "Join request declined. Dispatcher notified." };
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
