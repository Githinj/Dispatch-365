const { success, error, paginate, parsePagination } = require("../utils/response.utils");
const invoiceService = require("../services/invoice.service");
const receiptService = require("../services/receipt.service");

// GET /api/invoices
async function list(req, res, next) {
  try {
    const { page, perPage, skip } = parsePagination(req.query);
    const { status, fleetId, dateFrom, dateTo } = req.query;
    const result = await invoiceService.listInvoices({
      isolation: req.isolation,
      status, fleetId, dateFrom, dateTo,
      page, perPage, skip,
    });
    return res.json(paginate(result));
  } catch (err) { next(err); }
}

// GET /api/invoices/:id
async function getById(req, res, next) {
  try {
    const invoice = await invoiceService.getInvoiceById(req.params.id);
    if (!invoice) return res.status(404).json(error("Invoice not found."));
    // Isolation check
    if (req.isolation.agencyId && invoice.agencyId !== req.isolation.agencyId) {
      return res.status(403).json(error("Access denied."));
    }
    if (req.isolation.fleetId && invoice.fleetId !== req.isolation.fleetId) {
      return res.status(403).json(error("Access denied."));
    }
    return res.json(success("Invoice loaded.", invoice));
  } catch (err) { next(err); }
}

// POST /api/invoices/:id/payment
async function recordPayment(req, res, next) {
  try {
    const { amountPaid, paymentMethod, paymentDate, paymentReference, paymentNotes } = req.body;
    if (!amountPaid || !paymentMethod || !paymentDate) {
      return res.status(400).json(error("amountPaid, paymentMethod, and paymentDate are required."));
    }
    const validMethods = ["BANK_TRANSFER", "CHEQUE", "CASH", "OTHER"];
    if (!validMethods.includes(paymentMethod)) {
      return res.status(400).json(error("Invalid paymentMethod. Use: " + validMethods.join(", ")));
    }
    const result = await invoiceService.recordPayment(req.params.id, req.user.userId, {
      amountPaid, paymentMethod, paymentDate, paymentReference, paymentNotes,
    });
    if (!result) return res.status(404).json(error("Invoice not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Payment recorded.", result.invoice));
  } catch (err) { next(err); }
}

// POST /api/invoices/:id/dispute
async function raiseDispute(req, res, next) {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json(error("reason is required."));
    const result = await invoiceService.raiseDispute(req.params.id, req.user.userId, reason);
    if (!result) return res.status(404).json(error("Invoice not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Dispute raised.", result.invoice));
  } catch (err) { next(err); }
}

// POST /api/invoices/:id/resolve-dispute
async function resolveDispute(req, res, next) {
  try {
    const { resolution, amountPaid, paymentMethod, paymentDate, paymentReference, paymentNotes } = req.body;
    if (!resolution) return res.status(400).json(error("resolution is required (PAID or CANCELLED)."));
    const result = await invoiceService.resolveDispute(req.params.id, req.user.userId, {
      resolution, amountPaid, paymentMethod, paymentDate, paymentReference, paymentNotes,
    });
    if (!result) return res.status(404).json(error("Invoice not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Dispute resolved.", result.invoice));
  } catch (err) { next(err); }
}

// GET /api/invoices/:id/receipt
async function getReceipt(req, res, next) {
  try {
    const receipt = await receiptService.getReceiptByInvoiceId(req.params.id);
    if (!receipt) return res.status(404).json(error("Receipt not found for this invoice."));
    return res.json(success("Receipt loaded.", receipt));
  } catch (err) { next(err); }
}

// GET /api/invoices/receipts
async function listReceipts(req, res, next) {
  try {
    const { page, perPage, skip } = parsePagination(req.query);
    const { fleetId, dateFrom, dateTo } = req.query;
    const result = await receiptService.listReceipts({
      isolation: req.isolation,
      fleetId, dateFrom, dateTo,
      page, perPage, skip,
    });
    return res.json(paginate(result));
  } catch (err) { next(err); }
}

module.exports = { list, getById, recordPayment, raiseDispute, resolveDispute, getReceipt, listReceipts };
