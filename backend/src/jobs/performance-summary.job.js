// ── JOB 6: Monthly Performance Summary ─────────────────────────────
// Runs on the 1st of every month. Calculates stats for the previous
// calendar month and sends email + in-app notification to each user.

const { prisma } = require("../services/prisma.service");
const notificationService = require("../services/notification.service");
const emailService = require("../services/email.service");

async function run() {
  const now = new Date();

  // Only run on the 1st of the month
  if (now.getDate() !== 1) {
    console.log("[JOB] performance-summary: not the 1st — skipping.");
    return { skipped: true };
  }

  // Previous month range
  const prevMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const prevMonthEnd = new Date(now.getFullYear(), now.getMonth(), 1); // start of current month
  const monthLabel = prevMonthStart.toLocaleDateString("en-US", { month: "long", year: "numeric" });

  let dispatcherCount = 0;
  let driverCount = 0;

  // ── Step 1: Dispatcher summaries ──────────────────────────────────

  const dispatchers = await prisma.user.findMany({
    where: { role: "Dispatcher", dispatcherStatus: "ACTIVE" },
    select: { id: true, firstName: true, lastName: true, email: true },
  });

  for (const d of dispatchers) {
    const [created, completed, cancelled, disputed] = await Promise.all([
      prisma.load.count({ where: { dispatcherId: d.id, createdAt: { gte: prevMonthStart, lt: prevMonthEnd } } }),
      prisma.load.count({ where: { dispatcherId: d.id, completedAt: { gte: prevMonthStart, lt: prevMonthEnd } } }),
      prisma.load.count({ where: { dispatcherId: d.id, cancelledAt: { gte: prevMonthStart, lt: prevMonthEnd } } }),
      prisma.invoice.count({ where: { isDisputed: true, load: { dispatcherId: d.id }, createdAt: { gte: prevMonthStart, lt: prevMonthEnd } } }),
    ]);

    // Skip if no activity
    if (created === 0 && completed === 0) continue;

    // Calculate rates (safe division)
    const completionRate = created > 0 ? completed / created : 0;
    const disputeRate = completed > 0 ? disputed / completed : 0;

    // On-time and POD rates from completed loads
    let onTimeRate = 0;
    let podRate = 0;
    if (completed > 0) {
      const completedLoads = await prisma.load.findMany({
        where: { dispatcherId: d.id, completedAt: { gte: prevMonthStart, lt: prevMonthEnd } },
        select: { deliveryDate: true, completedAt: true, podUrl: true },
      });
      const onTime = completedLoads.filter((l) => l.deliveryDate && l.completedAt && l.completedAt <= new Date(new Date(l.deliveryDate).getTime() + 86400000)).length;
      const withPod = completedLoads.filter((l) => !!l.podUrl).length;
      onTimeRate = onTime / completed;
      podRate = withPod / completed;
    }

    const stats = {
      totalLoadsCreated: created,
      totalLoadsCompleted: completed,
      totalLoadsCancelled: cancelled,
      completionRate,
      onTimeDeliveryRate: onTimeRate,
      podAcceptanceRate: podRate,
      disputeRate,
    };

    // Send email
    const emailPayload = emailService.dispatcherMonthlyPerformance(d, stats, monthLabel);
    await notificationService.notify({
      userId: d.id,
      email: d.email,
      type: "MONTHLY_PERFORMANCE",
      title: `Performance Summary — ${monthLabel}`,
      message: `${completed} loads completed, ${(onTimeRate * 100).toFixed(0)}% on-time.`,
      data: { month: monthLabel, stats },
      emailPayload,
    });

    dispatcherCount++;
  }

  // ── Step 2: Driver summaries ──────────────────────────────────────

  const drivers = await prisma.user.findMany({
    where: { role: "Driver", driverStatus: { in: ["ACTIVE", "ON_LOAD"] } },
    select: { id: true, firstName: true, lastName: true, email: true },
  });

  for (const d of drivers) {
    const completed = await prisma.load.count({
      where: { driverId: d.id, completedAt: { gte: prevMonthStart, lt: prevMonthEnd } },
    });

    if (completed === 0) continue;

    const completedLoads = await prisma.load.findMany({
      where: { driverId: d.id, completedAt: { gte: prevMonthStart, lt: prevMonthEnd } },
      select: { deliveryDate: true, completedAt: true, podUrl: true },
    });

    const onTime = completedLoads.filter((l) => l.deliveryDate && l.completedAt && l.completedAt <= new Date(new Date(l.deliveryDate).getTime() + 86400000)).length;
    const withPod = completedLoads.filter((l) => !!l.podUrl).length;

    const stats = {
      totalLoadsCompleted: completed,
      onTimeDeliveryRate: onTime / completed,
      podAcceptanceRate: withPod / completed,
    };

    const emailPayload = emailService.driverMonthlyPerformance(d, stats, monthLabel);
    await notificationService.notify({
      userId: d.id,
      email: d.email,
      type: "MONTHLY_PERFORMANCE",
      title: `Performance Summary — ${monthLabel}`,
      message: `${completed} loads completed, ${((onTime / completed) * 100).toFixed(0)}% on-time.`,
      data: { month: monthLabel, stats },
      emailPayload,
    });

    driverCount++;
  }

  return { dispatcherCount, driverCount, month: monthLabel };
}

module.exports = { run };
