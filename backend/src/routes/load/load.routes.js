const { Router } = require("express");
const { authorize } = require("../../middleware/roles.middleware");
const c = require("../../controllers/load.controller");

const router = Router();

// All routes sit behind authenticate → isolate → stripFinancialFields → audit
// (applied globally in index.js for /api/*)

// ── Named / sub-resource paths before /:id ───────────────────────────

// GET /api/loads/dispatcher/:id/blocking — must come before /:id
router.get(
  "/dispatcher/:id/blocking",
  authorize("Dispatcher", "AgencyAdmin", "SuperAdmin"),
  c.blockingLoads
);

// ── Collection routes ─────────────────────────────────────────────────

router.post("/", authorize("Dispatcher"),                                       c.create);
router.get("/",  authorize("SuperAdmin", "AgencyAdmin", "Dispatcher", "FleetAdmin", "Driver"), c.list);

// ── Single-resource routes ────────────────────────────────────────────

router.get("/:id",             authorize("SuperAdmin", "AgencyAdmin", "Dispatcher", "FleetAdmin", "Driver"), c.getById);
router.patch("/:id",           authorize("Dispatcher"),                                           c.update);
router.post("/:id/cancel",     authorize("Dispatcher", "AgencyAdmin"),                            c.cancel);

// ── Lifecycle actions ─────────────────────────────────────────────────

router.post("/:id/start-trip",      authorize("Driver"),       c.startTrip);
// deliver uses multipart/form-data — uploadPodMiddleware runs first
router.post("/:id/deliver",         authorize("Driver"),       c.uploadPodMiddleware, c.deliver);
router.post("/:id/accept-delivery", authorize("Dispatcher"),   c.acceptDelivery);
router.post("/:id/reject-delivery", authorize("Dispatcher"),   c.rejectDelivery);

// ── Sub-resource reads ────────────────────────────────────────────────

router.get("/:id/status-history",   authorize("SuperAdmin", "AgencyAdmin", "Dispatcher", "FleetAdmin"), c.statusHistory);
router.get("/:id/pod",              authorize("SuperAdmin", "AgencyAdmin", "Dispatcher", "FleetAdmin", "Driver"), c.pod);

module.exports = router;
