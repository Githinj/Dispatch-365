// ── JOB 5: Subscription Expiry ──────────────────────────────────────
// Runs daily. Warns about expiring subscriptions, auto-suspends expired ones.

const { prisma } = require("../services/prisma.service");
const notificationService = require("../services/notification.service");
const superAdminService = require("../services/super-admin.service");

async function run() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const in7Days = new Date(today.getTime() + 7 * 86400000);
  const in8Days = new Date(today.getTime() + 8 * 86400000);

  // Load platform settings
  const settings = await prisma.platformSettings.findFirst();
  const graceDays = settings?.gracePeriodDays ?? 7;
  const autoSuspend = settings?.autoSuspendOnExpiry ?? true;

  const superAdmins = await prisma.user.findMany({
    where: { role: "SuperAdmin" },
    select: { id: true },
  });

  let warnCount = 0;
  let suspendCount = 0;

  // ── Step 1: Expiry warnings ───────────────────────────────────────

  // Expiring in 7 days
  const expiringIn7 = await prisma.agency.findMany({
    where: {
      isActive: true,
      suspendedAt: null,
      subscriptionExpiresAt: { gte: in7Days, lt: in8Days },
    },
    select: {
      id: true, name: true, subscriptionExpiresAt: true,
      users: { where: { role: "AgencyAdmin" }, select: { id: true, email: true }, take: 1 },
    },
  });

  for (const agency of expiringIn7) {
    const admin = agency.users[0];
    if (admin) {
      await notificationService.notify({
        userId: admin.id,
        email: admin.email,
        type: "SUBSCRIPTION_EXPIRY_WARNING",
        title: "Subscription Expiring",
        message: `Your subscription for ${agency.name} expires in 7 days.`,
        data: { agencyId: agency.id },
      });
    }
    if (superAdmins.length) {
      await notificationService.createNotificationsForMultiple(
        superAdmins.map((sa) => sa.id),
        "SUBSCRIPTION_EXPIRY_WARNING",
        "Agency Subscription Expiring",
        `Agency "${agency.name}" subscription expires in 7 days.`,
        { agencyId: agency.id },
      );
    }
    warnCount++;
  }

  // Expiring tomorrow
  const expiringTomorrow = await prisma.agency.findMany({
    where: {
      isActive: true,
      suspendedAt: null,
      subscriptionExpiresAt: { gte: today, lt: tomorrow },
    },
    select: {
      id: true, name: true,
      users: { where: { role: "AgencyAdmin" }, select: { id: true, email: true }, take: 1 },
    },
  });

  for (const agency of expiringTomorrow) {
    const admin = agency.users[0];
    if (admin) {
      await notificationService.notify({
        userId: admin.id,
        email: admin.email,
        type: "SUBSCRIPTION_EXPIRY_WARNING",
        title: "Subscription Expires Tomorrow",
        message: `Your subscription for ${agency.name} expires tomorrow.`,
        data: { agencyId: agency.id },
      });
    }
    warnCount++;
  }

  // ── Step 2: Auto-suspend expired agencies ─────────────────────────

  if (autoSuspend) {
    const graceExpired = new Date(today.getTime() - graceDays * 86400000);

    const toSuspend = await prisma.agency.findMany({
      where: {
        isActive: true,
        suspendedAt: null,
        subscriptionExpiresAt: { lt: graceExpired },
      },
      select: {
        id: true, name: true,
        users: { where: { role: "AgencyAdmin" }, select: { id: true, email: true }, take: 1 },
      },
    });

    for (const agency of toSuspend) {
      const result = await superAdminService.suspendAgency(agency.id, "Subscription expired");
      if (result?.success) {
        suspendCount++;

        // Audit
        await prisma.auditLog.create({
          data: {
            action: "AGENCY_AUTO_SUSPENDED",
            resource: "Agency",
            entityType: "Agency",
            entityId: agency.id,
            newValue: JSON.stringify({ reason: "Subscription expired", autoSuspend: true }),
          },
        }).catch(() => {});

        const admin = agency.users[0];
        if (admin) {
          await notificationService.notify({
            userId: admin.id,
            email: admin.email,
            type: "AGENCY_SUSPENDED",
            title: "Agency Suspended",
            message: `${agency.name} has been suspended due to subscription expiry.`,
            data: { agencyId: agency.id },
          });
        }

        if (superAdmins.length) {
          await notificationService.createNotificationsForMultiple(
            superAdmins.map((sa) => sa.id),
            "AGENCY_SUSPENDED",
            "Agency Auto-Suspended",
            `Agency "${agency.name}" auto-suspended — subscription expired + grace period passed.`,
            { agencyId: agency.id },
          );
        }
      }
    }
  }

  return { warnCount, suspendCount };
}

module.exports = { run };
