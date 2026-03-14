// ── JOB 3: Transfer Reminder ────────────────────────────────────────
// Runs daily. Reminds admins about pending transfers and suspended users.

const { prisma } = require("../services/prisma.service");
const notificationService = require("../services/notification.service");
const emailService = require("../services/email.service");

function daysSince(date) {
  return Math.ceil((Date.now() - new Date(date).getTime()) / 86400000);
}

async function run() {
  let reminderCount = 0;

  // ── Step 1: Dispatcher transfer reminders ─────────────────────────

  const dispatcherTransfers = await prisma.dispatcherTransferRequest.findMany({
    where: { status: { in: ["PENDING", "PARTIAL"] } },
    include: {
      dispatcher: { select: { id: true, firstName: true, lastName: true, email: true } },
      fromAgency: {
        select: { name: true, users: { where: { role: "AgencyAdmin" }, select: { id: true, email: true, firstName: true, lastName: true }, take: 1 } },
      },
      toAgency: {
        select: { name: true, users: { where: { role: "AgencyAdmin" }, select: { id: true, email: true, firstName: true, lastName: true }, take: 1 } },
      },
    },
  });

  const superAdmins = await prisma.user.findMany({
    where: { role: "SuperAdmin" },
    select: { id: true },
  });

  for (const t of dispatcherTransfers) {
    const days = daysSince(t.createdAt);
    const dispatcherName = `${t.dispatcher.firstName} ${t.dispatcher.lastName}`;

    // Remind admins at day 3 and day 7
    if (days === 3 || days === 7) {
      const fromAdmin = t.fromAgency.users[0];
      const toAdmin = t.toAgency.users[0];

      if (fromAdmin && t.fromAgencyApproved === null) {
        const emailPayload = emailService.transferPendingAdminReminder(
          t, fromAdmin.email, `${fromAdmin.firstName} ${fromAdmin.lastName}`, days
        );
        await notificationService.notify({
          userId: fromAdmin.id,
          email: fromAdmin.email,
          type: "TRANSFER_PENDING_REMINDER",
          title: "Transfer Awaiting Approval",
          message: `Transfer request for ${dispatcherName} has been pending ${days} days.`,
          data: { transferId: t.id, type: "dispatcher" },
          emailPayload,
        });
        reminderCount++;
      }

      if (toAdmin && t.toAgencyApproved === null) {
        const emailPayload = emailService.transferPendingAdminReminder(
          t, toAdmin.email, `${toAdmin.firstName} ${toAdmin.lastName}`, days
        );
        await notificationService.notify({
          userId: toAdmin.id,
          email: toAdmin.email,
          type: "TRANSFER_PENDING_REMINDER",
          title: "Transfer Awaiting Approval",
          message: `Transfer request for ${dispatcherName} has been pending ${days} days.`,
          data: { transferId: t.id, type: "dispatcher" },
          emailPayload,
        });
        reminderCount++;
      }
    }

    // Escalate to Super Admin at day 14
    if (days === 14 && superAdmins.length) {
      await notificationService.createNotificationsForMultiple(
        superAdmins.map((sa) => sa.id),
        "TRANSFER_ESCALATION",
        "Transfer Pending 14 Days",
        `Transfer request for dispatcher ${dispatcherName} has been pending 14 days.`,
        { transferId: t.id, type: "dispatcher" },
      );
      reminderCount++;
    }

    // Remind suspended dispatcher every 3 days
    if (days % 3 === 0) {
      const emailPayload = emailService.dispatcherSuspensionReminder(t.dispatcher, "pending transfer", null);
      await notificationService.notify({
        userId: t.dispatcher.id,
        email: t.dispatcher.email,
        type: "SUSPENSION_REMINDER",
        title: "Account Still Suspended",
        message: "Your transfer request is still pending approval. You cannot create loads until resolved.",
        data: { transferId: t.id },
        emailPayload,
      });
      reminderCount++;
    }
  }

  // ── Step 2: Driver transfer reminders (same pattern) ──────────────

  const driverTransfers = await prisma.driverTransferRequest.findMany({
    where: { status: { in: ["PENDING", "PARTIAL"] } },
    include: {
      driver: { select: { id: true, firstName: true, lastName: true, email: true } },
      fromFleet: {
        select: { name: true, users: { where: { role: "FleetAdmin" }, select: { id: true, email: true, firstName: true, lastName: true }, take: 1 } },
      },
      toFleet: {
        select: { name: true, users: { where: { role: "FleetAdmin" }, select: { id: true, email: true, firstName: true, lastName: true }, take: 1 } },
      },
    },
  });

  for (const t of driverTransfers) {
    const days = daysSince(t.createdAt);
    const driverName = `${t.driver.firstName} ${t.driver.lastName}`;

    if (days === 3 || days === 7) {
      const fromAdmin = t.fromFleet.users[0];
      const toAdmin = t.toFleet.users[0];

      if (fromAdmin && t.fromFleetApproved === null) {
        await notificationService.notify({
          userId: fromAdmin.id,
          email: fromAdmin.email,
          type: "TRANSFER_PENDING_REMINDER",
          title: "Driver Transfer Awaiting Approval",
          message: `Transfer request for driver ${driverName} has been pending ${days} days.`,
          data: { transferId: t.id, type: "driver" },
        });
        reminderCount++;
      }

      if (toAdmin && t.toFleetApproved === null) {
        await notificationService.notify({
          userId: toAdmin.id,
          email: toAdmin.email,
          type: "TRANSFER_PENDING_REMINDER",
          title: "Driver Transfer Awaiting Approval",
          message: `Transfer request for driver ${driverName} has been pending ${days} days.`,
          data: { transferId: t.id, type: "driver" },
        });
        reminderCount++;
      }
    }

    if (days === 14 && superAdmins.length) {
      await notificationService.createNotificationsForMultiple(
        superAdmins.map((sa) => sa.id),
        "TRANSFER_ESCALATION",
        "Driver Transfer Pending 14 Days",
        `Transfer request for driver ${driverName} has been pending 14 days.`,
        { transferId: t.id, type: "driver" },
      );
      reminderCount++;
    }

    if (days % 3 === 0) {
      const emailPayload = emailService.driverSuspensionReminder(t.driver, "pending transfer", null);
      await notificationService.notify({
        userId: t.driver.id,
        email: t.driver.email,
        type: "SUSPENSION_REMINDER",
        title: "Account Still Suspended",
        message: "Your transfer request is still pending. You cannot receive loads until resolved.",
        data: { transferId: t.id },
        emailPayload,
      });
      reminderCount++;
    }
  }

  // ── Step 3: Restoration pending reminders ─────────────────────────

  // Dispatchers awaiting restoration
  const restorationDispatchers = await prisma.user.findMany({
    where: { role: "Dispatcher", dispatcherStatus: "SUSPENDED_RESTORATION" },
    select: {
      id: true, firstName: true, lastName: true, email: true, updatedAt: true,
      agency: { select: { users: { where: { role: "AgencyAdmin" }, select: { id: true, email: true }, take: 1 } } },
    },
  });

  for (const d of restorationDispatchers) {
    const days = daysSince(d.updatedAt);
    if (days % 3 !== 0) continue;

    const agencyAdmin = d.agency?.users?.[0];
    if (agencyAdmin) {
      await notificationService.notify({
        userId: agencyAdmin.id,
        email: agencyAdmin.email,
        type: "RESTORATION_PENDING_REMINDER",
        title: "Restoration Pending",
        message: `Dispatcher ${d.firstName} ${d.lastName} is awaiting restoration approval.`,
        data: { dispatcherId: d.id },
      });
      reminderCount++;
    }

    await notificationService.createNotification({
      userId: d.id,
      type: "RESTORATION_PENDING_REMINDER",
      title: "Awaiting Restoration",
      message: "Your account is awaiting restoration approval from your agency admin.",
    });
    reminderCount++;
  }

  // Drivers awaiting restoration
  const restorationDrivers = await prisma.user.findMany({
    where: { role: "Driver", driverStatus: "SUSPENDED_RESTORATION" },
    select: {
      id: true, firstName: true, lastName: true, email: true, updatedAt: true,
      fleet: { select: { users: { where: { role: "FleetAdmin" }, select: { id: true, email: true }, take: 1 } } },
    },
  });

  for (const d of restorationDrivers) {
    const days = daysSince(d.updatedAt);
    if (days % 3 !== 0) continue;

    const fleetAdmin = d.fleet?.users?.[0];
    if (fleetAdmin) {
      await notificationService.notify({
        userId: fleetAdmin.id,
        email: fleetAdmin.email,
        type: "RESTORATION_PENDING_REMINDER",
        title: "Driver Restoration Pending",
        message: `Driver ${d.firstName} ${d.lastName} is awaiting restoration approval.`,
        data: { driverId: d.id },
      });
      reminderCount++;
    }

    await notificationService.createNotification({
      userId: d.id,
      type: "RESTORATION_PENDING_REMINDER",
      title: "Awaiting Restoration",
      message: "Your account is awaiting restoration approval from your fleet admin.",
    });
    reminderCount++;
  }

  return { reminderCount };
}

module.exports = { run };
