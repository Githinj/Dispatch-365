const { prisma } = require("./prisma.service");

// ── Receipt number generation ─────────────────────────────────────────

/**
 * Must be called inside a Prisma transaction (tx).
 * @unique constraint on receiptNumber is the final race guard.
 */
async function generateReceiptNumber(tx) {
  const year = new Date().getFullYear();
  const latest = await tx.receipt.findFirst({
    where: { receiptNumber: { startsWith: `RCP-${year}-` } },
    orderBy: { receiptNumber: "desc" },
    select: { receiptNumber: true },
  });
  let seq = 1;
  if (latest?.receiptNumber) {
    seq = parseInt(latest.receiptNumber.split("-")[2], 10) + 1;
  }
  return `RCP-${year}-${String(seq).padStart(4, "0")}`;
}

// ── Auto-generate receipt (called from invoice.service on PAID) ────────

/**
 * Idempotent — safe to call multiple times for the same invoice.
 * Captures an immutable financial snapshot at the moment of generation.
 */
async function generateReceipt(invoiceId, recordedById) {
  // Guard: already generated
  const existing = await prisma.receipt.findUnique({ where: { invoiceId } });
  if (existing) return existing;

  const invoice = await prisma.invoice.findUnique({
    where: { id: invoiceId },
    include: {
      load: {
        select: {
          origin: true,
          destination: true,
          deliveryDate: true,
          driver: { select: { firstName: true, lastName: true } },
        },
      },
      agency: { select: { name: true } },
      fleet: { select: { name: true } },
    },
  });
  if (!invoice) return null;
  if (invoice.status !== "PAID") return null;

  // Recorder name snapshot
  const recorder = await prisma.user.findUnique({
    where: { id: recordedById },
    select: { firstName: true, lastName: true },
  });
  const recordedByName = recorder
    ? `${recorder.firstName} ${recorder.lastName}`.trim()
    : "Agency Admin";

  const driverName = invoice.load.driver
    ? `${invoice.load.driver.firstName} ${invoice.load.driver.lastName}`.trim()
    : null;

  const receipt = await prisma.$transaction(async (tx) => {
    const receiptNumber = await generateReceiptNumber(tx);
    return tx.receipt.create({
      data: {
        receiptNumber,
        invoiceId,
        loadId: invoice.loadId,
        agencyId: invoice.agencyId,
        agencyName: invoice.agency.name,
        fleetId: invoice.fleetId,
        fleetName: invoice.fleet.name,
        driverName,
        route: `${invoice.load.origin} → ${invoice.load.destination}`,
        deliveryDate: invoice.load.deliveryDate || null,
        // Financial snapshot
        loadRate: invoice.loadRate,
        commissionPercent: invoice.commissionPercent,
        commissionAmount: invoice.commissionAmount,
        dispatcherEarnings: invoice.dispatcherEarnings,
        fleetEarnings: invoice.fleetEarnings,
        // Payment snapshot
        amountPaid: invoice.paidAmount,
        paymentMethod: invoice.paymentMethod,
        paymentReference: invoice.paymentReference || null,
        paymentDate: invoice.paymentDate,
        recordedById,
        recordedByName,
      },
    });
  });

  console.log(`[Receipt] Generated ${receipt.receiptNumber} for invoice ${invoice.invoiceNumber}`);

  // Trigger PDF generation in background (failure doesn't block the receipt)
  setImmediate(async () => {
    try {
      const pdfService = require("./pdf.service");
      const pdfUrl = await pdfService.generateReceiptPdf(receipt.id);
      if (pdfUrl) {
        await prisma.receipt.update({ where: { id: receipt.id }, data: { pdfUrl } });
        console.log(`[PDF] Receipt PDF cached: ${pdfUrl}`);
      }
    } catch (err) {
      console.error("[PDF] Background receipt PDF generation failed:", err.message);
    }
  });

  return receipt;
}

// ── Get receipt by ID ─────────────────────────────────────────────────

async function getReceiptById(id) {
  return prisma.receipt.findUnique({
    where: { id },
    include: {
      invoice: { select: { invoiceNumber: true, status: true } },
    },
  });
}

// ── Get receipt by invoice ID ─────────────────────────────────────────

async function getReceiptByInvoiceId(invoiceId) {
  return prisma.receipt.findUnique({
    where: { invoiceId },
    include: {
      invoice: { select: { invoiceNumber: true, status: true } },
    },
  });
}

// ── List receipts ─────────────────────────────────────────────────────

async function listReceipts({ isolation, fleetId, dateFrom, dateTo, page, perPage, skip }) {
  const where = {};
  if (isolation.agencyId) where.agencyId = isolation.agencyId;
  if (isolation.fleetId) where.fleetId = isolation.fleetId;
  if (fleetId && !where.fleetId) where.fleetId = fleetId;

  if (dateFrom || dateTo) {
    where.generatedAt = {};
    if (dateFrom) where.generatedAt.gte = new Date(dateFrom);
    if (dateTo) where.generatedAt.lte = new Date(dateTo);
  }

  const [data, total] = await Promise.all([
    prisma.receipt.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { generatedAt: "desc" },
      select: {
        id: true,
        receiptNumber: true,
        agencyName: true,
        fleetName: true,
        route: true,
        amountPaid: true,
        paymentMethod: true,
        paymentDate: true,
        generatedAt: true,
        pdfUrl: true,
        invoice: { select: { invoiceNumber: true } },
      },
    }),
    prisma.receipt.count({ where }),
  ]);

  return { data, total, page, perPage };
}

module.exports = {
  generateReceipt,
  getReceiptById,
  getReceiptByInvoiceId,
  listReceipts,
};
