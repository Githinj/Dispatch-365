const { Router } = require("express");
const { authorize } = require("../../middleware/roles.middleware");
const c = require("../../controllers/dispatcher.controller");

const router = Router();

// All routes sit behind authenticate → isolate → stripFinancialFields → audit
// (applied globally in index.js for /api/*)

// ── Registration flow ─────────────────────────────────────────────────
// IMPORTANT: named paths must come before /:id

router.post("/invite",                    authorize("AgencyAdmin"),                    c.invite);
router.post("/register/:inviteToken",     authorize("Dispatcher", "AgencyAdmin"),      c.register);

// ── Transfer sub-routes (before /:id) ────────────────────────────────
router.post("/transfer/request",          authorize("Dispatcher"),                     c.requestTransfer);
router.post("/transfer/:id/approve",      authorize("AgencyAdmin"),                    c.approveTransfer);
router.post("/transfer/:id/decline",      authorize("AgencyAdmin"),                    c.declineTransfer);
router.post("/transfer/:id/cancel",       authorize("Dispatcher"),                     c.cancelTransfer);

// ── Restoration sub-routes (before /:id) ─────────────────────────────
router.post("/restoration/:id/approve",   authorize("AgencyAdmin"),                    c.approveRestoration);
router.post("/restoration/:id/decline",   authorize("AgencyAdmin"),                    c.declineRestoration);

// ── Join-request sub-routes (before /:id) ────────────────────────────
router.post("/join/request",              authorize("Dispatcher"),                     c.requestJoin);
router.post("/join/:id/approve",          authorize("AgencyAdmin"),                    c.approveJoin);
router.post("/join/:id/decline",          authorize("AgencyAdmin"),                    c.declineJoin);

// ── Rating sub-routes (before /:id) ──────────────────────────────────
router.post("/ratings/:id/flag",          authorize("Dispatcher"),                     c.flagRating);
router.post("/ratings/:id/respond",       authorize("Dispatcher"),                     c.respondToRating);

// ── Main CRUD ─────────────────────────────────────────────────────────
router.get("/",                           authorize("AgencyAdmin", "SuperAdmin"),       c.list);
router.get("/:id",                        authorize("AgencyAdmin", "SuperAdmin", "Dispatcher"), c.getById);
router.post("/:id/approve",               authorize("AgencyAdmin"),                    c.approve);
router.post("/:id/reject",                authorize("AgencyAdmin"),                    c.reject);
router.post("/:id/suspend",               authorize("AgencyAdmin"),                    c.suspend);
router.get("/:id/blocking-loads",         authorize("AgencyAdmin", "Dispatcher"),      c.blockingLoads);
router.get("/:id/performance",            authorize("AgencyAdmin", "SuperAdmin", "Dispatcher"), c.performance);
router.get("/:id/ratings",                authorize("AgencyAdmin", "SuperAdmin", "Dispatcher"), c.listRatings);
router.post("/:id/rate",                  authorize("AgencyAdmin"),                    c.rate);

module.exports = router;
