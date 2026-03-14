const { Router } = require("express");
const { authorize } = require("../../middleware/roles.middleware");
const fleetController = require("../../controllers/fleet.controller");

const router = Router();

// All routes below sit behind authenticate → isolate → stripFinancialFields → audit
// (applied globally in index.js for /api/*)

// ── Agency Admin invites a fleet ─────────────────────────────────────
router.post(
  "/invite",
  authorize("AgencyAdmin"),
  fleetController.invite
);

// ── Fleet registers after invite (Fleet Admin or unauthenticated — see note) ──
// Registration uses a token-based flow. The route is protected (requires auth)
// but a future iteration could make it public with token-only auth.
router.post(
  "/register/:inviteToken",
  authorize("FleetAdmin", "SuperAdmin"),
  fleetController.register
);

// ── SuperAdmin: pending approvals ────────────────────────────────────
router.get(
  "/pending",
  authorize("SuperAdmin"),
  fleetController.listPending
);

// ── SuperAdmin: expiring documents ───────────────────────────────────
// IMPORTANT: this must be before /:id to avoid "expiring-documents" matching as an id
router.get(
  "/expiring-documents",
  authorize("SuperAdmin"),
  fleetController.expiringDocuments
);

// ── Agency Admin: see their fleet relationships ──────────────────────
// IMPORTANT: must be before /:id to avoid "my-fleets" matching as an id
router.get(
  "/my-fleets",
  authorize("AgencyAdmin"),
  fleetController.myFleets
);

// ── SuperAdmin: list all fleets ──────────────────────────────────────
router.get(
  "/",
  authorize("SuperAdmin"),
  fleetController.listAll
);

// ── Fleet Admin or SuperAdmin: view single fleet ─────────────────────
router.get(
  "/:id",
  authorize("SuperAdmin", "FleetAdmin"),
  fleetController.getById
);

// ── Fleet Admin updates own profile, SuperAdmin can update any ───────
router.patch(
  "/:id",
  authorize("SuperAdmin", "FleetAdmin"),
  fleetController.update
);

// ── SuperAdmin: approve / reject / suspend / reactivate ──────────────
router.post(
  "/:id/approve",
  authorize("SuperAdmin"),
  fleetController.approve
);

router.post(
  "/:id/reject",
  authorize("SuperAdmin"),
  fleetController.reject
);

router.post(
  "/:id/suspend",
  authorize("SuperAdmin"),
  fleetController.suspend
);

router.post(
  "/:id/reactivate",
  authorize("SuperAdmin"),
  fleetController.reactivate
);

module.exports = router;
