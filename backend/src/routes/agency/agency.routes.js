const { Router } = require("express");
const { authorize } = require("../../middleware/roles.middleware");
const agencyController = require("../../controllers/agency.controller");

const router = Router();

// All routes below are already behind authenticate + isolate + stripFinancialFields + audit
// (applied in index.js for all /api/* protected routes)

// ── SuperAdmin + AgencyAdmin can list/view ───────────────────────────
router.get(
  "/",
  authorize("SuperAdmin", "AgencyAdmin"),
  agencyController.list
);

router.get(
  "/:id",
  authorize("SuperAdmin", "AgencyAdmin"),
  agencyController.getById
);

// ── SuperAdmin creates agencies ──────────────────────────────────────
router.post(
  "/",
  authorize("SuperAdmin"),
  agencyController.create
);

// ── AgencyAdmin updates own agency, SuperAdmin updates any ───────────
router.put(
  "/:id",
  authorize("SuperAdmin", "AgencyAdmin"),
  agencyController.update
);

// ── SuperAdmin-only operations ───────────────────────────────────────
router.patch(
  "/:id/subscription",
  authorize("SuperAdmin"),
  agencyController.updateSubscription
);

router.post(
  "/:id/suspend",
  authorize("SuperAdmin"),
  agencyController.suspend
);

router.post(
  "/:id/reactivate",
  authorize("SuperAdmin"),
  agencyController.reactivate
);

module.exports = router;
