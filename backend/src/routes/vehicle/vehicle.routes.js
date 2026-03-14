const { Router } = require("express");
const { authorize } = require("../../middleware/roles.middleware");
const c = require("../../controllers/vehicle.controller");

const router = Router();

// All routes sit behind authenticate → isolate → stripFinancialFields → audit
// (applied globally in index.js for /api/*)

// ── Named paths before /:id ───────────────────────────────────────────

router.get("/available",            authorize("Dispatcher", "FleetAdmin", "SuperAdmin"),   c.available);
router.get("/expiring-documents",   authorize("SuperAdmin", "FleetAdmin"),                 c.expiringDocuments);

// ── Main CRUD ─────────────────────────────────────────────────────────

router.post("/",                    authorize("FleetAdmin"),                                c.create);
router.get("/",                     authorize("FleetAdmin", "SuperAdmin"),                  c.list);
router.get("/:id",                  authorize("FleetAdmin", "SuperAdmin", "Dispatcher"),    c.getById);
router.patch("/:id",                authorize("FleetAdmin"),                                c.update);
router.delete("/:id",               authorize("FleetAdmin"),                                c.retire);

// ── Maintenance sub-routes ────────────────────────────────────────────

router.post("/:id/maintenance/start",              authorize("FleetAdmin"),   c.maintenanceStart);
router.post("/:id/maintenance/:recordId/complete", authorize("FleetAdmin"),   c.maintenanceComplete);
router.get("/:id/maintenance",                     authorize("FleetAdmin", "SuperAdmin"), c.maintenanceHistory);

module.exports = router;
