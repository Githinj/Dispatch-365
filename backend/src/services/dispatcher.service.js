const crypto = require("crypto");
const bcrypt = require("bcrypt");
const { prisma } = require("./prisma.service");
const { destroySession } = require("./redis.service");

// ── Invite ───────────────────────────────────────────────────────────

async function inviteDispatcher({ email, firstName, lastName, agencyId }) {
  const inviteToken = crypto.randomBytes(32).toString("hex");

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) return { error: "A user with this email already exists." };

  const user = await prisma.user.create({
    data: {
      email,
      firstName,
      lastName,
      password: "", // placeholder — set on registration
      role: "Dispatcher",
      dispatcherStatus: "PENDING",
      agencyId,
      inviteToken,
      isActive: false,
    },
  });

  return { user, inviteToken };
}

// ── Register via invite ──────────────────────────────────────────────

async function registerDispatcher(inviteToken, data) {
  const user = await prisma.user.findUnique({ where: { inviteToken } });
  if (!user) return { error: "Invalid invite token." };
  if (user.role !== "Dispatcher") return { error: "Invalid invite token." };

  const hashedPassword = await bcrypt.hash(data.password, 10);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: {
      firstName: data.firstName || user.firstName,
      lastName: data.lastName || user.lastName,
      phone: data.phone,
      password: hashedPassword,
      inviteToken: null, // consume the token
    },
  });

  return {
    user: {
      id: updated.id,
      email: updated.email,
      firstName: updated.firstName,
      lastName: updated.lastName,
      dispatcherStatus: updated.dispatcherStatus,
    },
  };
}

// ── List dispatchers (scoped to agency) ──────────────────────────────

async function listDispatchers({ agencyId, page, perPage, skip, status }) {
  const where = { agencyId, role: "Dispatcher" };
  if (status) where.dispatcherStatus = status;

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
        dispatcherStatus: true,
        isActive: true,
        createdAt: true,
        dispatcherStats: true,
      },
    }),
    prisma.user.count({ where }),
  ]);

  return { data, total, page, perPage };
}

// ── Get dispatcher by ID ─────────────────────────────────────────────

async function getDispatcherById(id) {
  return prisma.user.findFirst({
    where: { id, role: "Dispatcher" },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      phone: true,
      agencyId: true,
      dispatcherStatus: true,
      isActive: true,
      createdAt: true,
      dispatcherStats: true,
      dispatcherAgencyHistory: {
        orderBy: { startDate: "desc" },
        include: { agency: { select: { id: true, name: true } } },
      },
    },
  });
}

// ── Approve dispatcher ───────────────────────────────────────────────

async function approveDispatcher(id, agencyId) {
  const user = await prisma.user.findFirst({
    where: { id, role: "Dispatcher", agencyId, dispatcherStatus: "PENDING" },
  });
  if (!user) return null;

  return prisma.$transaction(async (tx) => {
    const updated = await tx.user.update({
      where: { id },
      data: { dispatcherStatus: "ACTIVE", isActive: true },
    });

    // Create initial agency history record
    await tx.dispatcherAgencyHistory.create({
      data: { dispatcherId: id, agencyId },
    });

    // Create initial stats record
    await tx.dispatcherStats.upsert({
      where: { dispatcherId: id },
      create: { dispatcherId: id },
      update: {},
    });

    return updated;
  });
}

// ── Reject dispatcher ────────────────────────────────────────────────

async function rejectDispatcher(id, agencyId, reason) {
  const user = await prisma.user.findFirst({
    where: { id, role: "Dispatcher", agencyId, dispatcherStatus: "PENDING" },
  });
  if (!user) return null;

  return prisma.user.update({
    where: { id },
    data: { dispatcherStatus: "INACTIVE", isActive: false },
  });
}

// ── Suspend dispatcher ───────────────────────────────────────────────

async function suspendDispatcher(id, agencyId) {
  const user = await prisma.user.findFirst({
    where: { id, role: "Dispatcher", agencyId, dispatcherStatus: "ACTIVE" },
  });
  if (!user) return null;

  await destroySession(id);

  return prisma.user.update({
    where: { id },
    data: { dispatcherStatus: "SUSPENDED_TRANSFER", isActive: false },
  });
}

// ── Blocking loads check ─────────────────────────────────────────────

const BLOCKING_STATUSES = ["DRAFT", "ASSIGNED", "IN_TRANSIT"];

const BLOCKING_INSTRUCTIONS = {
  DRAFT: "Complete the load details and assign a fleet, or cancel it",
  ASSIGNED: "Ensure the fleet executes and marks it delivered",
  IN_TRANSIT: "Wait for the driver to complete the delivery",
};

async function getBlockingLoads(dispatcherId) {
  const loads = await prisma.load.findMany({
    where: {
      dispatcherId,
      status: { in: BLOCKING_STATUSES },
    },
    select: {
      id: true,
      status: true,
      origin: true,
      destination: true,
      createdAt: true,
    },
  });

  return loads.map((load) => ({
    ...load,
    instruction: BLOCKING_INSTRUCTIONS[load.status],
  }));
}

// ── Performance stats ────────────────────────────────────────────────

async function updateDispatcherStats(dispatcherId) {
  const loads = await prisma.load.findMany({
    where: { dispatcherId },
    select: {
      status: true,
      deliveryDate: true,
      completedAt: true,
      podUrl: true,
    },
  });

  const totalLoadsCreated = loads.length;
  const completedLoads = loads.filter((l) => l.status === "COMPLETED");
  const cancelledLoads = loads.filter((l) => l.status === "CANCELLED");
  const totalLoadsCompleted = completedLoads.length;
  const totalLoadsCancelled = cancelledLoads.length;

  const completionRate =
    totalLoadsCreated > 0
      ? (totalLoadsCompleted / totalLoadsCreated) * 100
      : 0;

  // On-time: completed on or before scheduled deliveryDate
  const onTimeCount = completedLoads.filter(
    (l) => l.deliveryDate && l.completedAt && l.completedAt <= l.deliveryDate
  ).length;
  const onTimeDeliveryRate =
    totalLoadsCompleted > 0 ? (onTimeCount / totalLoadsCompleted) * 100 : 0;

  // POD acceptance: loads with a podUrl (first-time accept proxy)
  const podCount = completedLoads.filter((l) => l.podUrl).length;
  const podAcceptanceRate =
    totalLoadsCompleted > 0 ? (podCount / totalLoadsCompleted) * 100 : 0;

  // Dispute rate: loads with DISPUTED invoices
  const disputedCount = await prisma.invoice.count({
    where: {
      load: { dispatcherId, status: "COMPLETED" },
      status: "DISPUTED",
    },
  });
  const disputeRate =
    totalLoadsCompleted > 0 ? (disputedCount / totalLoadsCompleted) * 100 : 0;

  // Auto score: weighted average of stats out of 5.0
  // completionRate (25%), onTimeRate (30%), podRate (25%), inverse disputeRate (20%)
  const autoScore =
    (completionRate / 100) * 5 * 0.25 +
    (onTimeDeliveryRate / 100) * 5 * 0.3 +
    (podAcceptanceRate / 100) * 5 * 0.25 +
    ((100 - disputeRate) / 100) * 5 * 0.2;

  // Admin rating average
  const ratingAgg = await prisma.dispatcherRating.aggregate({
    where: { dispatcherId, isFlagged: false },
    _avg: { score: true },
  });
  const adminRatingAverage = ratingAgg._avg.score || 0;

  // Overall: 60% auto + 40% admin (if admin ratings exist)
  const overallRating =
    adminRatingAverage > 0
      ? autoScore * 0.6 + adminRatingAverage * 0.4
      : autoScore;

  return prisma.dispatcherStats.upsert({
    where: { dispatcherId },
    create: {
      dispatcherId,
      totalLoadsCreated,
      totalLoadsCompleted,
      totalLoadsCancelled,
      completionRate: Math.round(completionRate * 100) / 100,
      onTimeDeliveryRate: Math.round(onTimeDeliveryRate * 100) / 100,
      podAcceptanceRate: Math.round(podAcceptanceRate * 100) / 100,
      disputeRate: Math.round(disputeRate * 100) / 100,
      autoScore: Math.round(autoScore * 100) / 100,
      adminRatingAverage: Math.round(adminRatingAverage * 100) / 100,
      overallRating: Math.round(overallRating * 100) / 100,
    },
    update: {
      totalLoadsCreated,
      totalLoadsCompleted,
      totalLoadsCancelled,
      completionRate: Math.round(completionRate * 100) / 100,
      onTimeDeliveryRate: Math.round(onTimeDeliveryRate * 100) / 100,
      podAcceptanceRate: Math.round(podAcceptanceRate * 100) / 100,
      disputeRate: Math.round(disputeRate * 100) / 100,
      autoScore: Math.round(autoScore * 100) / 100,
      adminRatingAverage: Math.round(adminRatingAverage * 100) / 100,
      overallRating: Math.round(overallRating * 100) / 100,
    },
  });
}

// ── Get performance stats ────────────────────────────────────────────

async function getPerformanceStats(dispatcherId) {
  return prisma.dispatcherStats.findUnique({
    where: { dispatcherId },
  });
}

// ── Ratings ──────────────────────────────────────────────────────────

async function rateDispatcher({ dispatcherId, authorId, score, comment }) {
  const rating = await prisma.dispatcherRating.create({
    data: { dispatcherId, authorId, score, comment },
  });

  // Recalculate stats after new rating
  await updateDispatcherStats(dispatcherId);

  return rating;
}

async function getDispatcherRatings(dispatcherId, { page, perPage, skip }) {
  const where = { dispatcherId };

  const [data, total] = await Promise.all([
    prisma.dispatcherRating.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
      include: {
        author: { select: { id: true, firstName: true, lastName: true, role: true } },
      },
    }),
    prisma.dispatcherRating.count({ where }),
  ]);

  return { data, total, page, perPage };
}

async function flagRating(ratingId, dispatcherId, reason) {
  const rating = await prisma.dispatcherRating.findFirst({
    where: { id: ratingId, dispatcherId },
  });
  if (!rating) return null;

  return prisma.dispatcherRating.update({
    where: { id: ratingId },
    data: { isFlagged: true, flagReason: reason },
  });
}

async function respondToRating(ratingId, dispatcherId, response) {
  const rating = await prisma.dispatcherRating.findFirst({
    where: { id: ratingId, dispatcherId },
  });
  if (!rating) return null;
  if (rating.response) return { error: "Already responded to this rating." };

  return prisma.dispatcherRating.update({
    where: { id: ratingId },
    data: { response },
  });
}

module.exports = {
  inviteDispatcher,
  registerDispatcher,
  listDispatchers,
  getDispatcherById,
  approveDispatcher,
  rejectDispatcher,
  suspendDispatcher,
  getBlockingLoads,
  updateDispatcherStats,
  getPerformanceStats,
  rateDispatcher,
  getDispatcherRatings,
  flagRating,
  respondToRating,
};
