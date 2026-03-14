const { Router } = require("express");
const { authorize } = require("../../middleware/roles.middleware");
const c = require("../../controllers/driver.controller");

const router = Router();

// All routes sit behind authenticate → isolate → stripFinancialFields → audit
// (applied globally in index.js for /api/*)
// Driver mobile endpoints benefit from auth.middleware.js guardDriverSession logic
// (session extended automatically when driver has an IN_TRANSIT load).

// ── Named paths before /:id ───────────────────────────────────────────

router.post("/invite",                   authorize("FleetAdmin"),                          c.invite);
router.post("/register/:inviteToken",    authorize("Driver", "FleetAdmin"),               c.register);
router.get("/available",                 authorize("Dispatcher", "FleetAdmin", "SuperAdmin"), c.available);

// ── Transfer sub-routes ───────────────────────────────────────────────
router.post("/transfer/request",         authorize("Driver"),                              c.requestTransfer);
router.post("/transfer/:id/approve",     authorize("FleetAdmin"),                          c.approveTransfer);
router.post("/transfer/:id/decline",     authorize("FleetAdmin"),                          c.declineTransfer);
router.post("/transfer/:id/cancel",      authorize("Driver"),                              c.cancelTransfer);

// ── Restoration sub-routes ────────────────────────────────────────────
router.post("/restoration/:id/approve",  authorize("FleetAdmin"),                          c.approveRestoration);
router.post("/restoration/:id/decline",  authorize("FleetAdmin"),                          c.declineRestoration);

// ── Join sub-routes ───────────────────────────────────────────────────
router.post("/join/request",             authorize("Driver"),                              c.requestJoin);
router.post("/join/:id/approve",         authorize("FleetAdmin"),                          c.approveJoin);
router.post("/join/:id/decline",         authorize("FleetAdmin"),                          c.declineJoin);

// ── Main CRUD ─────────────────────────────────────────────────────────
router.get("/",                          authorize("FleetAdmin", "SuperAdmin"),             c.list);
router.get("/:id",                       authorize("FleetAdmin", "SuperAdmin", "Driver"),   c.getById);
router.post("/:id/approve",              authorize("FleetAdmin"),                           c.approve);
router.post("/:id/reject",               authorize("FleetAdmin"),                           c.reject);
router.post("/:id/suspend",              authorize("FleetAdmin"),                           c.suspend);
router.get("/:id/blocking-loads",        authorize("FleetAdmin", "Driver"),                 c.blockingLoads);
router.get("/:id/performance",           authorize("FleetAdmin", "SuperAdmin", "Driver", "Dispatcher"), c.performance);

// ── Mobile: driver's own load history ────────────────────────────────
router.get("/:id/loads",                 authorize("Driver", "FleetAdmin", "SuperAdmin"),   c.driverLoads);

module.exports = router;
