const { prisma } = require("./prisma.service");

// ── Invoice number generation ─────────────────────────────────────────

/**
 * Must be called inside a Prisma transaction (tx).
 * @unique constraint on invoiceNumber is the final race guard.
 */
async function generateInvoiceNumber(tx) {
  const year = new Date().getFullYear();
  const latest = await tx.invoice.findFirst({
    where: { invoiceNumber: { startsWith: `INV-${year}-` } },
    orderBy: { invoiceNumber: "desc" },
    select: { invoiceNumber: true },
  });
  let seq = 1;
  if (latest?.invoiceNumber) {
    seq = parseInt(latest.invoiceNumber.split("-")[2], 10) + 1;
  }
  return `INV-${year}-${String(seq).padStart(4, "0")}`;
}

// ── Auto-generate invoice (called from load-lifecycle after COMPLETED) ─

/**
 * Idempotent — safe to call multiple times for the same load.
 * Returns the invoice (existing or newly created).
 */
async function generateInvoice(loadId) {
  // Guard: already generated
  const existing = await prisma.invoice.findUnique({ where: { loadId } });
  if (existing) return existing;

  const load = await prisma.load.findUnique({
    where: { id: loadId },
    include: { agency: { select: { paymentTermsDays: true } } },
  });
  if (!load || load.status !== "COMPLETED" || !load.fleetId) return null;

  const dueDate = new Date(load.completedAt);
  dueDate.setDate(dueDate.getDate() + (load.agency.paymentTermsDays ?? 30));

  const invoice = await prisma.$transaction(async (tx) => {
    const invoiceNumber = await generateInvoiceNumber(tx);
    return tx.invoice.create({
      data: {
        invoiceNumber,
        loadId,
        agencyId: load.agencyId,
        fleetId: load.fleetId,
        loadRate: load.loadRate || 0,
        commissionPercent: load.commissionPercent || 0,
        commissionAmount: load.commissionAmount || 0,
        dispatcherEarnings: load.dispatcherEarnings || 0,
        fleetEarnings: load.fleetEarnings || 0,
        dueDate,
        status: "UNPAID",
      },
    });
  });

  // TODO: notifyFleetAdmin(load.fleetId, `Invoice ${invoice.invoiceNumber} generated. Due: ${dueDate}`);
  // TODO: notifyAgencyAdmin(load.agencyId, `Invoice ${invoice.invoiceNumber} generated for Load ${load.loadNumber}`);
  console.log(`[Invoice] Generated ${invoice.invoiceNumber} — due ${dueDate.toISOString().split("T")[0]}`);

  return invoice;
}

// ── List invoices ─────────────────────────────────────────────────────

async function listInvoices({ isolation, status, fleetId, dateFrom, dateTo, page, perPage, skip }) {
  const where = { ...isolation };

  if (status) where.status = status.toUpperCase();
  if (fleetId && !where.fleetId) where.fleetId = fleetId;
  if (dateFrom || dateTo) {
    where.generatedAt = {};
    if (dateFrom) where.generatedAt.gte = new Date(dateFrom);
    if (dateTo) where.generatedAt.lte = new Date(dateTo);
  }

  const [data, total] = await Promise.all([
    prisma.invoice.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { generatedAt: "desc" },
      select: {
        id: true,
        invoiceNumber: true,
        status: true,
        loadRate: true,
        commissionPercent: true,
        commissionAmount: true,
        fleetEarnings: true,
        dispatcherEarnings: true,
        dueDate: true,
        generatedAt: true,
        paidAt: true,
        paidAmount: true,
        isDisputed: true,
        pdfUrl: true,
        load: { select: { id: true, loadNumber: true, origin: true, destination: true } },
        fleet: { select: { id: true, name: true } },
        agency: { select: { id: true, name: true } },
      },
    }),
    prisma.invoice.count({ where }),
  ]);

  return { data, total, page, perPage };
}

// ── Get invoice by ID ─────────────────────────────────────────────────

async function getInvoiceById(id) {
  return prisma.invoice.findUnique({
    where: { id },
    include: {
      load: {
        select: {
          id: true,
          loadNumber: true,
          origin: true,
          destination: true,
          deliveryDate: true,
          completedAt: true,
          driver: { select: { firstName: true, lastName: true } },
          dispatcher: { select: { firstName: true, lastName: true } },
        },
      },
      fleet: { select: { id: true, name: true, contactEmail: true, contactPhone: true } },
      agency: {
        select: {
          id: true,
          name: true,
          logoUrl: true,
          primaryColor: true,
          secondaryColor: true,
          footerText: true,
          paymentTermsDays: true,
        },
      },
      receipt: {
        select: {
          id: true,
          receiptNumber: true,
          amountPaid: true,
          paymentDate: true,
          pdfUrl: true,
          generatedAt: true,
        },
      },
    },
  });
}

// ── Record payment (AgencyAdmin only) ────────────────────────────────

async function recordPayment(
  invoiceId,
  recordedById,
  { amountPaid, paymentMethod, paymentDate, paymentReference, paymentNotes }
) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return null;
  if (["PAID", "CANCELLED"].includes(invoice.status)) {
    return { error: `Invoice is already ${invoice.status.toLowerCase()}.` };
  }

  const newStatus = amountPaid >= invoice.fleetEarnings ? "PAID" : "PARTIALLY_PAID";

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: newStatus,
      paidAmount: amountPaid,
      paidAt: new Date(),
      paymentMethod,
      paymentDate: new Date(paymentDate),
      paymentReference: paymentReference || null,
      paymentNotes: paymentNotes || null,
      paymentRecordedById: recordedById,
    },
  });

  if (newStatus === "PAID") {
    // Auto-generate receipt
    try {
      const receiptService = require("./receipt.service");
      await receiptService.generateReceipt(invoiceId, recordedById);
    } catch (err) {
      console.error("[Receipt] Auto-generation failed:", err.message);
    }
    // TODO: notifyFleetAdmin with receipt download link
    console.log(
      `[Notify] Fleet Admin (fleet ${invoice.fleetId}): Payment of $${amountPaid} received for ${invoice.invoiceNumber}.`
    );
  }

  return { invoice: updated };
}

// ── Raise dispute ─────────────────────────────────────────────────────

async function raiseDispute(invoiceId, userId, reason) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return null;
  if (invoice.status === "DISPUTED") return { error: "Invoice is already disputed." };
  if (invoice.status === "PAID") return { error: "Cannot dispute a paid invoice." };
  if (invoice.status === "CANCELLED") return { error: "Cannot dispute a cancelled invoice." };

  const updated = await prisma.invoice.update({
    where: { id: invoiceId },
    data: {
      status: "DISPUTED",
      isDisputed: true,
      disputeReason: reason,
      disputeRaisedAt: new Date(),
      disputeRaisedById: userId,
    },
  });

  // TODO: notify both agency admin and fleet admin
  console.log(`[Notify] Dispute raised on ${invoice.invoiceNumber}: ${reason}`);
  return { invoice: updated };
}

// ── Resolve dispute (AgencyAdmin only) ───────────────────────────────

async function resolveDispute(invoiceId, agencyAdminId, { resolution, amountPaid, paymentMethod, paymentDate, paymentReference, paymentNotes }) {
  const invoice = await prisma.invoice.findUnique({ where: { id: invoiceId } });
  if (!invoice) return null;
  if (invoice.status !== "DISPUTED") return { error: "Invoice is not disputed." };

  const validResolutions = ["PAID", "CANCELLED"];
  if (!validResolutions.includes(resolution)) {
    return { error: "Invalid resolution. Use PAID or CANCELLED." };
  }

  const now = new Date();
  let data = { disputeResolvedAt: now };

  if (resolution === "PAID") {
    if (!amountPaid || !paymentMethod || !paymentDate) {
      return { error: "amountPaid, paymentMethod, and paymentDate are required to resolve as PAID." };
    }
    data = {
      ...data,
      status: "PAID",
      paidAmount: amountPaid,
      paidAt: now,
      paymentMethod,
      paymentDate: new Date(paymentDate),
      paymentReference: paymentReference || null,
      paymentNotes: paymentNotes || null,
      paymentRecordedById: agencyAdminId,
    };
  } else {
    data.status = "CANCELLED";
  }

  const updated = await prisma.invoice.update({ where: { id: invoiceId }, data });

  if (resolution === "PAID") {
    try {
      const receiptService = require("./receipt.service");
      await receiptService.generateReceipt(invoiceId, agencyAdminId);
    } catch (err) {
      console.error("[Receipt] Failed to generate receipt after dispute resolution:", err.message);
    }
  }

  // TODO: notify both parties of resolution
  console.log(`[Notify] Dispute on ${invoice.invoiceNumber} resolved: ${resolution}`);
  return { invoice: updated };
}

// ── Overdue automation (daily cron) ───────────────────────────────────

async function processOverdueInvoices() {
  const now = new Date();
  // today = midnight of current day (local timezone-safe)
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrow = new Date(today.getTime() + 86400000);
  const in3Days = new Date(today.getTime() + 3 * 86400000);
  const in4Days = new Date(today.getTime() + 4 * 86400000);

  // 1. Mark OVERDUE: dueDate has already passed (before today), still UNPAID or PARTIALLY_PAID
  const { count: overdueCount } = await prisma.invoice.updateMany({
    where: {
      status: { in: ["UNPAID", "PARTIALLY_PAID"] },
      dueDate: { lt: today },
    },
    data: { status: "OVERDUE" },
  });

  if (overdueCount > 0) {
    const newlyOverdue = await prisma.invoice.findMany({
      where: { status: "OVERDUE", dueDate: { lt: today, gte: new Date(today.getTime() - 86400000) } },
      select: { invoiceNumber: true, agencyId: true, fleetId: true },
    });
    for (const inv of newlyOverdue) {
      // TODO: notifyAgencyAdmin, notifyFleetAdmin
      console.log(`[Notify] Invoice ${inv.invoiceNumber} is now OVERDUE.`);
    }
    console.log(`[Cron] Marked ${overdueCount} invoice(s) OVERDUE.`);
  }

  // 2. Due-today reminder
  const dueToday = await prisma.invoice.findMany({
    where: {
      status: { in: ["UNPAID", "PARTIALLY_PAID"] },
      dueDate: { gte: today, lt: tomorrow },
    },
    select: { invoiceNumber: true, agencyId: true, fleetId: true },
  });
  for (const inv of dueToday) {
    // TODO: notifyAgencyAdmin, notifyFleetAdmin
    console.log(`[Notify] Invoice ${inv.invoiceNumber} is due today.`);
  }

  // 3. 3-day-ahead reminder
  const dueSoon = await prisma.invoice.findMany({
    where: {
      status: { in: ["UNPAID", "PARTIALLY_PAID"] },
      dueDate: { gte: in3Days, lt: in4Days },
    },
    select: { invoiceNumber: true, agencyId: true, fleetId: true },
  });
  for (const inv of dueSoon) {
    // TODO: notifyAgencyAdmin, notifyFleetAdmin
    console.log(`[Notify] Invoice ${inv.invoiceNumber} is due in 3 days.`);
  }

  console.log(
    `[Cron] Invoice check: overdue=${overdueCount}, due-today=${dueToday.length}, due-in-3d=${dueSoon.length}`
  );
}

/**
 * Starts the daily overdue cron.
 * Runs once immediately on startup, then every 24 hours.
 */
function startInvoiceCron() {
  processOverdueInvoices().catch((err) =>
    console.error("[Cron] Invoice overdue check failed on startup:", err.message)
  );
  setInterval(() => {
    processOverdueInvoices().catch((err) =>
      console.error("[Cron] Invoice overdue check failed:", err.message)
    );
  }, 24 * 60 * 60 * 1000);
  console.log("[Cron] Invoice overdue scheduler started (runs every 24 h).");
}

module.exports = {
  generateInvoice,
  listInvoices,
  getInvoiceById,
  recordPayment,
  raiseDispute,
  resolveDispute,
  processOverdueInvoices,
  startInvoiceCron,
};
