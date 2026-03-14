const { success, error, paginate, parsePagination } = require("../utils/response.utils");
const svc = require("../services/super-admin.service");

// ── Dashboard ───────────────────────────────────────────────────────

async function dashboard(req, res, next) {
  try {
    const data = await svc.getDashboard();
    return res.json(success("Dashboard loaded.", data));
  } catch (err) { next(err); }
}

// ── Agency Management ───────────────────────────────────────────────

async function listAgencies(req, res, next) {
  try {
    const { page, perPage, skip } = parsePagination(req.query);
    const { status, plan, search } = req.query;
    const result = await svc.listAgencies({ status, plan, search, page, perPage, skip });
    return res.json(paginate(result));
  } catch (err) { next(err); }
}

async function getAgency(req, res, next) {
  try {
    const data = await svc.getAgencyDetail(req.params.id);
    if (!data) return res.status(404).json(error("Agency not found."));
    return res.json(success("Agency details loaded.", data));
  } catch (err) { next(err); }
}

async function suspendAgency(req, res, next) {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json(error("reason is required."));
    const result = await svc.suspendAgency(req.params.id, reason);
    if (!result) return res.status(404).json(error("Agency not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Agency suspended."));
  } catch (err) { next(err); }
}

async function reactivateAgency(req, res, next) {
  try {
    const result = await svc.reactivateAgency(req.params.id);
    if (!result) return res.status(404).json(error("Agency not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Agency reactivated."));
  } catch (err) { next(err); }
}

async function updateSubscription(req, res, next) {
  try {
    const { plan } = req.body;
    const valid = ["BASIC", "PRO", "ENTERPRISE", "FREE"];
    if (!plan || !valid.includes(plan)) return res.status(400).json(error("Valid plan required: " + valid.join(", ")));
    const result = await svc.updateAgencySubscription(req.params.id, plan);
    if (!result) return res.status(404).json(error("Agency not found."));
    return res.json(success("Subscription updated.", result.agency));
  } catch (err) { next(err); }
}

// ── Fleet Management ────────────────────────────────────────────────

async function listFleets(req, res, next) {
  try {
    const { page, perPage, skip } = parsePagination(req.query);
    const { status, search } = req.query;
    const result = await svc.listFleets({ status, search, page, perPage, skip });
    return res.json(paginate(result));
  } catch (err) { next(err); }
}

async function getFleet(req, res, next) {
  try {
    const data = await svc.getFleetDetail(req.params.id);
    if (!data) return res.status(404).json(error("Fleet not found."));
    return res.json(success("Fleet details loaded.", data));
  } catch (err) { next(err); }
}

async function getPendingFleets(req, res, next) {
  try {
    const data = await svc.getPendingFleets();
    return res.json(success("Pending fleets loaded.", data));
  } catch (err) { next(err); }
}

async function approveFleet(req, res, next) {
  try {
    const result = await svc.approveFleet(req.params.id);
    if (!result) return res.status(404).json(error("Fleet not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Fleet approved.", { invitingAgencyIds: result.invitingAgencyIds }));
  } catch (err) { next(err); }
}

async function rejectFleet(req, res, next) {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json(error("reason is required."));
    const result = await svc.rejectFleet(req.params.id, reason);
    if (!result) return res.status(404).json(error("Fleet not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Fleet rejected."));
  } catch (err) { next(err); }
}

async function suspendFleet(req, res, next) {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json(error("reason is required."));
    const result = await svc.suspendFleet(req.params.id, reason);
    if (!result) return res.status(404).json(error("Fleet not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Fleet suspended."));
  } catch (err) { next(err); }
}

async function reactivateFleet(req, res, next) {
  try {
    const result = await svc.reactivateFleet(req.params.id);
    if (!result) return res.status(404).json(error("Fleet not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Fleet reactivated."));
  } catch (err) { next(err); }
}

// ── Dispatcher Management ───────────────────────────────────────────

async function listDispatchers(req, res, next) {
  try {
    const { page, perPage, skip } = parsePagination(req.query);
    const { status, agencyId, search } = req.query;
    const result = await svc.listDispatchers({ status, agencyId, search, page, perPage, skip });
    return res.json(paginate(result));
  } catch (err) { next(err); }
}

async function getDispatcher(req, res, next) {
  try {
    const data = await svc.getDispatcherDetail(req.params.id);
    if (!data) return res.status(404).json(error("Dispatcher not found."));
    return res.json(success("Dispatcher details loaded.", data));
  } catch (err) { next(err); }
}

async function forceRestoreDispatcher(req, res, next) {
  try {
    const { reason } = req.body;
    if (!reason) return res.status(400).json(error("reason is required."));
    const result = await svc.forceRestoreDispatcher(req.params.id, reason);
    if (!result) return res.status(404).json(error("Dispatcher not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Dispatcher force-restored."));
  } catch (err) { next(err); }
}

async function manuallyAssignDispatcher(req, res, next) {
  try {
    const { agencyId } = req.body;
    if (!agencyId) return res.status(400).json(error("agencyId is required."));
    const result = await svc.manuallyAssignDispatcher(req.params.id, agencyId);
    if (!result) return res.status(404).json(error("Dispatcher not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Dispatcher manually assigned."));
  } catch (err) { next(err); }
}

// ── Driver Management ───────────────────────────────────────────────

async function listDrivers(req, res, next) {
  try {
    const { page, perPage, skip } = parsePagination(req.query);
    const { status, fleetId, search } = req.query;
    const result = await svc.listDrivers({ status, fleetId, search, page, perPage, skip });
    return res.json(paginate(result));
  } catch (err) { next(err); }
}

async function getDriver(req, res, next) {
  try {
    const data = await svc.getDriverDetail(req.params.id);
    if (!data) return res.status(404).json(error("Driver not found."));
    return res.json(success("Driver details loaded.", data));
  } catch (err) { next(err); }
}

// ── Document Expiry ─────────────────────────────────────────────────

async function expiringDocuments(req, res, next) {
  try {
    const data = await svc.getExpiringDocuments();
    return res.json(success("Expiring documents loaded.", data));
  } catch (err) { next(err); }
}

// ── Loads ───────────────────────────────────────────────────────────

async function listLoads(req, res, next) {
  try {
    const { page, perPage, skip } = parsePagination(req.query);
    const { status, agencyId, fleetId, dispatcherId, driverId, dateFrom, dateTo } = req.query;
    const result = await svc.listLoads({ status, agencyId, fleetId, dispatcherId, driverId, dateFrom, dateTo, page, perPage, skip });
    return res.json(paginate(result));
  } catch (err) { next(err); }
}

async function getLoad(req, res, next) {
  try {
    const data = await svc.getLoadDetail(req.params.id);
    if (!data) return res.status(404).json(error("Load not found."));
    return res.json(success("Load details loaded.", data));
  } catch (err) { next(err); }
}

// ── Financials ──────────────────────────────────────────────────────

async function financials(req, res, next) {
  try {
    const data = await svc.getFinancials();
    return res.json(success("Financial overview loaded.", data));
  } catch (err) { next(err); }
}

async function listInvoices(req, res, next) {
  try {
    const { page, perPage, skip } = parsePagination(req.query);
    const { status, agencyId, fleetId, dateFrom, dateTo } = req.query;
    const result = await svc.listInvoices({ status, agencyId, fleetId, dateFrom, dateTo, page, perPage, skip });
    return res.json(paginate(result));
  } catch (err) { next(err); }
}

// ── Ratings ─────────────────────────────────────────────────────────

async function flaggedRatings(req, res, next) {
  try {
    const data = await svc.getFlaggedRatings();
    return res.json(success("Flagged ratings loaded.", data));
  } catch (err) { next(err); }
}

async function removeRating(req, res, next) {
  try {
    const { removalReason } = req.body;
    if (!removalReason) return res.status(400).json(error("removalReason is required."));
    const result = await svc.removeRating(req.params.id, req.user.userId, removalReason);
    if (!result) return res.status(404).json(error("Rating not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Rating removed.", { unfairPattern: result.unfairPattern }));
  } catch (err) { next(err); }
}

async function keepRating(req, res, next) {
  try {
    const result = await svc.keepRating(req.params.id);
    if (!result) return res.status(404).json(error("Rating not found."));
    return res.json(success("Rating kept. Flag dismissed."));
  } catch (err) { next(err); }
}

// ── Impersonation ───────────────────────────────────────────────────

async function startImpersonation(req, res, next) {
  try {
    const result = await svc.startImpersonation(req.user.userId, req.params.userId);
    if (!result) return res.status(404).json(error("User not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Impersonation started. Token valid for 15 minutes.", {
      impersonationToken: result.impersonationToken,
      targetUser: result.targetUser,
    }));
  } catch (err) { next(err); }
}

async function endImpersonation(req, res, next) {
  try {
    return res.json(success("Impersonation ended."));
  } catch (err) { next(err); }
}

// ── Settings ────────────────────────────────────────────────────────

async function getSettings(req, res, next) {
  try {
    const data = await svc.getSettings();
    return res.json(success("Platform settings loaded.", data));
  } catch (err) { next(err); }
}

async function updateSettings(req, res, next) {
  try {
    const result = await svc.updateSettings(req.body);
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Settings updated.", result.settings));
  } catch (err) { next(err); }
}

// ── Subscription Plans ──────────────────────────────────────────────

async function listPlans(req, res, next) {
  try {
    const data = await svc.listPlans();
    return res.json(success("Plans loaded.", data));
  } catch (err) { next(err); }
}

async function createPlan(req, res, next) {
  try {
    const { plan, priceMonthly, maxDispatchers, maxLoadsPerMonth, features } = req.body;
    if (!plan) return res.status(400).json(error("plan is required."));
    const data = await svc.createPlan({ plan, priceMonthly, maxDispatchers, maxLoadsPerMonth, features });
    return res.status(201).json(success("Plan created.", data));
  } catch (err) { next(err); }
}

async function updatePlan(req, res, next) {
  try {
    const data = await svc.updatePlan(req.params.id, req.body);
    if (!data) return res.status(404).json(error("Plan not found."));
    return res.json(success("Plan updated.", data));
  } catch (err) { next(err); }
}

// ── Audit Logs ──────────────────────────────────────────────────────

async function auditLogs(req, res, next) {
  try {
    const { page, perPage, skip } = parsePagination({ ...req.query, perPage: req.query.perPage || 50 });
    const { actorId, actionType, entityType, entityId, agencyId, dateFrom, dateTo } = req.query;
    const result = await svc.listAuditLogs({ actorId, actionType, entityType, entityId, agencyId, dateFrom, dateTo, page, perPage, skip });
    return res.json(paginate(result));
  } catch (err) { next(err); }
}

// ── Pending Transfers ───────────────────────────────────────────────

async function pendingTransfers(req, res, next) {
  try {
    const data = await svc.getPendingTransfers();
    return res.json(success("Pending transfers loaded.", data));
  } catch (err) { next(err); }
}

module.exports = {
  dashboard,
  // Agency
  listAgencies, getAgency, suspendAgency, reactivateAgency, updateSubscription,
  // Fleet
  listFleets, getFleet, getPendingFleets, approveFleet, rejectFleet, suspendFleet, reactivateFleet,
  // Dispatcher
  listDispatchers, getDispatcher, forceRestoreDispatcher, manuallyAssignDispatcher,
  // Driver
  listDrivers, getDriver,
  // Documents
  expiringDocuments,
  // Loads
  listLoads, getLoad,
  // Financials
  financials, listInvoices,
  // Ratings
  flaggedRatings, removeRating, keepRating,
  // Impersonation
  startImpersonation, endImpersonation,
  // Settings
  getSettings, updateSettings,
  // Plans
  listPlans, createPlan, updatePlan,
  // Audit
  auditLogs,
  // Transfers
  pendingTransfers,
};
