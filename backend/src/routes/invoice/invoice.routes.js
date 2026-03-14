const { Router } = require("express");
const { authorize } = require("../../middleware/roles.middleware");
const ctrl = require("../../controllers/invoice.controller");

const router = Router();

// Named sub-resources before /:id
router.get("/receipts", ctrl.listReceipts);

// Collection
router.get("/", ctrl.list);

// Single resource
router.get("/:id", ctrl.getById);

// Payment recording — AgencyAdmin only
router.post("/:id/payment", authorize("AgencyAdmin"), ctrl.recordPayment);

// Dispute — FleetAdmin or AgencyAdmin
router.post("/:id/dispute", authorize("FleetAdmin", "AgencyAdmin"), ctrl.raiseDispute);

// Resolve dispute — AgencyAdmin only
router.post("/:id/resolve-dispute", authorize("AgencyAdmin"), ctrl.resolveDispute);

// Receipt for invoice
router.get("/:id/receipt", ctrl.getReceipt);

module.exports = router;
