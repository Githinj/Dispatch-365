// ── JOB 1: Invoice Overdue Check ────────────────────────────────────
// Runs daily. Marks overdue invoices, sends due-today and 3-day reminders.

const { prisma } = require("../services/prisma.service");
const notificationService = require("../services/notification.service");
const emailService = require("../services/email.service");

async function run() {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const in3Days = new Date(today.getTime() + 3 * 86400000);
  const in4Days = new Date(today.getTime() + 4 * 86400000);

  // ── Step 1: Mark overdue (dueDate < today, still UNPAID / PARTIALLY_PAID)
  const overdueInvoices = await prisma.invoice.findMany({
    where: {
      status: { in: ["UNPAID", "PARTIALLY_PAID"] },
      dueDate: { lt: today },
    },
    include: {
      agency: { select: { id: true, name: true, users: { where: { role: "AgencyAdmin" }, select: { id: true, email: true }, take: 1 } } },
      fleet: { select: { id: true, name: true, users: { where: { role: "FleetAdmin" }, select: { id: true, email: true }, take: 1 } } },
    },
  });

  if (overdueInvoices.length) {
    await prisma.invoice.updateMany({
      where: {
        id: { in: overdueInvoices.map((i) => i.id) },
        status: { in: ["UNPAID", "PARTIALLY_PAID"] },
      },
      data: { status: "OVERDUE" },
    });

    for (const inv of overdueInvoices) {
      const agencyAdmin = inv.agency.users[0];
      const fleetAdmin = inv.fleet.users[0];

      // Audit log
      await prisma.auditLog.create({
        data: {
          action: "INVOICE_MARKED_OVERDUE",
          resource: "Invoice",
          entityType: "Invoice",
          entityId: inv.id,
          newValue: JSON.stringify({ status: "OVERDUE", invoiceNumber: inv.invoiceNumber }),
        },
      }).catch(() => {});

      // Notifications + emails
      const emailPayload = await emailService.invoiceOverdue(inv, inv.agency, inv.fleet);

      if (agencyAdmin) {
        await notificationService.notify({
          userId: agencyAdmin.id,
          email: agencyAdmin.email,
          type: "INVOICE_OVERDUE",
          title: "Invoice Overdue",
          message: `Invoice #${inv.invoiceNumber} is now overdue.`,
          data: { invoiceId: inv.id },
          emailPayload,
        });
      }
      if (fleetAdmin) {
        await notificationService.notify({
          userId: fleetAdmin.id,
          email: fleetAdmin.email,
          type: "INVOICE_OVERDUE",
          title: "Invoice Overdue",
          message: `Invoice #${inv.invoiceNumber} is now overdue.`,
          data: { invoiceId: inv.id },
          emailPayload,
        });
      }
    }
    console.log(`[JOB] invoice-overdue: marked ${overdueInvoices.length} invoice(s) OVERDUE`);
  }

  // ── Step 2: Due today reminders
  const dueToday = await prisma.invoice.findMany({
    where: {
      status: { in: ["UNPAID", "PARTIALLY_PAID"] },
      dueDate: { gte: today, lt: tomorrow },
    },
    include: {
      agency: { select: { id: true, name: true, users: { where: { role: "AgencyAdmin" }, select: { id: true, email: true }, take: 1 } } },
      fleet: { select: { id: true, name: true, users: { where: { role: "FleetAdmin" }, select: { id: true, email: true }, take: 1 } } },
    },
  });

  for (const inv of dueToday) {
    const emailPayload = await emailService.invoiceDueToday(inv, inv.agency, inv.fleet);
    const agencyAdmin = inv.agency.users[0];
    const fleetAdmin = inv.fleet.users[0];

    if (agencyAdmin) {
      await notificationService.notify({
        userId: agencyAdmin.id,
        email: agencyAdmin.email,
        type: "INVOICE_DUE_TODAY",
        title: "Invoice Due Today",
        message: `Invoice #${inv.invoiceNumber} is due today.`,
        data: { invoiceId: inv.id },
        emailPayload,
      });
    }
    if (fleetAdmin) {
      await notificationService.notify({
        userId: fleetAdmin.id,
        email: fleetAdmin.email,
        type: "INVOICE_DUE_TODAY",
        title: "Invoice Due Today",
        message: `Invoice #${inv.invoiceNumber} is due today.`,
        data: { invoiceId: inv.id },
        emailPayload,
      });
    }
  }

  // ── Step 3: Due in 3 days reminders
  const dueSoon = await prisma.invoice.findMany({
    where: {
      status: { in: ["UNPAID", "PARTIALLY_PAID"] },
      dueDate: { gte: in3Days, lt: in4Days },
    },
    include: {
      agency: { select: { id: true, name: true, users: { where: { role: "AgencyAdmin" }, select: { id: true, email: true }, take: 1 } } },
      fleet: { select: { id: true, name: true, users: { where: { role: "FleetAdmin" }, select: { id: true, email: true }, take: 1 } } },
    },
  });

  for (const inv of dueSoon) {
    const emailPayload = await emailService.invoiceDueReminder(inv, inv.agency, inv.fleet, 3);
    const agencyAdmin = inv.agency.users[0];
    const fleetAdmin = inv.fleet.users[0];

    if (agencyAdmin) {
      await notificationService.notify({
        userId: agencyAdmin.id,
        email: agencyAdmin.email,
        type: "INVOICE_DUE_REMINDER",
        title: "Invoice Due in 3 Days",
        message: `Invoice #${inv.invoiceNumber} is due in 3 days.`,
        data: { invoiceId: inv.id },
        emailPayload,
      });
    }
    if (fleetAdmin) {
      await notificationService.notify({
        userId: fleetAdmin.id,
        email: fleetAdmin.email,
        type: "INVOICE_DUE_REMINDER",
        title: "Invoice Due in 3 Days",
        message: `Invoice #${inv.invoiceNumber} is due in 3 days.`,
        data: { invoiceId: inv.id },
        emailPayload,
      });
    }
  }

  return { overdue: overdueInvoices.length, dueToday: dueToday.length, dueSoon: dueSoon.length };
}

module.exports = { run };
