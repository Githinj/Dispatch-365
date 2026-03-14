const { Router } = require("express");
const { authorize } = require("../../middleware/roles.middleware");
const ctrl = require("../../controllers/super-admin.controller");

const router = Router();

// ── Middleware: all routes require SuperAdmin ────────────────────────
// authenticate + isolate + stripFinancialFields + audit are applied
// globally in index.js for all /api/* routes.
// We add an extra authorize("SuperAdmin") guard on every endpoint.
const sa = authorize("SuperAdmin");

// ── Dashboard ───────────────────────────────────────────────────────
router.get("/dashboard", sa, ctrl.dashboard);

// ── Agency management ───────────────────────────────────────────────
router.get("/agencies", sa, ctrl.listAgencies);
router.get("/agencies/:id", sa, ctrl.getAgency);
router.post("/agencies/:id/suspend", sa, ctrl.suspendAgency);
router.post("/agencies/:id/reactivate", sa, ctrl.reactivateAgency);
router.patch("/agencies/:id/subscription", sa, ctrl.updateSubscription);

// ── Fleet management ────────────────────────────────────────────────
router.get("/fleets/pending", sa, ctrl.getPendingFleets); // before :id
router.get("/fleets", sa, ctrl.listFleets);
router.get("/fleets/:id", sa, ctrl.getFleet);
router.post("/fleets/:id/approve", sa, ctrl.approveFleet);
router.post("/fleets/:id/reject", sa, ctrl.rejectFleet);
router.post("/fleets/:id/suspend", sa, ctrl.suspendFleet);
router.post("/fleets/:id/reactivate", sa, ctrl.reactivateFleet);

// ── Dispatcher management ───────────────────────────────────────────
router.get("/dispatchers", sa, ctrl.listDispatchers);
router.get("/dispatchers/:id", sa, ctrl.getDispatcher);
router.post("/dispatchers/:id/force-restore", sa, ctrl.forceRestoreDispatcher);
router.post("/dispatchers/:id/manually-assign", sa, ctrl.manuallyAssignDispatcher);

// ── Driver management ───────────────────────────────────────────────
router.get("/drivers", sa, ctrl.listDrivers);
router.get("/drivers/:id", sa, ctrl.getDriver);

// ── Document expiry monitoring ──────────────────────────────────────
router.get("/expiring-documents", sa, ctrl.expiringDocuments);

// ── Load visibility (no isolation) ──────────────────────────────────
router.get("/loads", sa, ctrl.listLoads);
router.get("/loads/:id", sa, ctrl.getLoad);

// ── Financial overview ──────────────────────────────────────────────
router.get("/financials", sa, ctrl.financials);
router.get("/invoices", sa, ctrl.listInvoices);

// ── Rating management ───────────────────────────────────────────────
router.get("/ratings/flagged", sa, ctrl.flaggedRatings);
router.post("/ratings/:id/remove", sa, ctrl.removeRating);
router.post("/ratings/:id/keep", sa, ctrl.keepRating);

// ── Impersonation ───────────────────────────────────────────────────
router.post("/impersonate/:userId", sa, ctrl.startImpersonation);
router.post("/impersonate/end", sa, ctrl.endImpersonation);

// ── Platform settings ───────────────────────────────────────────────
router.get("/settings", sa, ctrl.getSettings);
router.patch("/settings", sa, ctrl.updateSettings);

// ── Subscription plan configuration ────────────────────────────────
router.get("/plans", sa, ctrl.listPlans);
router.post("/plans", sa, ctrl.createPlan);
router.patch("/plans/:id", sa, ctrl.updatePlan);

// ── Audit logs ──────────────────────────────────────────────────────
router.get("/audit-logs", sa, ctrl.auditLogs);

// ── Pending transfers monitor ───────────────────────────────────────
router.get("/pending-transfers", sa, ctrl.pendingTransfers);

module.exports = router;
