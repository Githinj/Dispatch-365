const { z } = require("zod");
const dispatcherService = require("../services/dispatcher.service");
const transferService = require("../services/dispatcher-transfer.service");
const { success, error, paginate, parsePagination } = require("../utils/response.utils");

// ── Validation schemas ───────────────────────────────────────────────

const inviteSchema = z.object({
  email: z.string().email(),
  firstName: z.string().min(1),
  lastName: z.string().min(1),
});

const registerSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().min(1).optional(),
  phone: z.string().min(5).optional(),
  password: z.string().min(8, "Password must be at least 8 characters."),
});

const rejectSchema = z.object({
  reason: z.string().min(3, "Rejection reason required."),
});

const transferRequestSchema = z.object({
  toAgencyId: z.string().uuid(),
});

const approveTransferSchema = z.object({
  transferId: z.string().uuid(),
});

const declineTransferSchema = z.object({
  reason: z.string().min(3),
});

const joinRequestSchema = z.object({
  agencyId: z.string().uuid(),
});

const rateSchema = z.object({
  score: z.number().int().min(1).max(5),
  comment: z.string().optional(),
});

const flagSchema = z.object({
  reason: z.string().min(5),
});

const respondSchema = z.object({
  response: z.string().min(1),
});

// ── Invite ────────────────────────────────────────────────────────────

async function invite(req, res, next) {
  try {
    const data = inviteSchema.parse(req.body);
    const result = await dispatcherService.inviteDispatcher({
      ...data,
      agencyId: req.user.agencyId,
    });
    if (result.error) return res.status(400).json(error(result.error));
    return res.status(201).json(success("Dispatcher invited.", { id: result.user.id, inviteToken: result.inviteToken }));
  } catch (err) { next(err); }
}

// ── Register ──────────────────────────────────────────────────────────

async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body);
    const result = await dispatcherService.registerDispatcher(req.params.inviteToken, data);
    if (result.error) return res.status(400).json(error(result.error));
    return res.status(201).json(success("Registration complete. Awaiting agency approval.", result.user));
  } catch (err) { next(err); }
}

// ── List ──────────────────────────────────────────────────────────────

async function list(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const result = await dispatcherService.listDispatchers({
      agencyId: req.user.agencyId,
      status: req.query.status,
      ...pagination,
    });
    return res.json(success("Dispatchers retrieved.", paginate(result)));
  } catch (err) { next(err); }
}

// ── Get by ID ─────────────────────────────────────────────────────────

async function getById(req, res, next) {
  try {
    const dispatcher = await dispatcherService.getDispatcherById(req.params.id);
    if (!dispatcher) return res.status(404).json(error("Dispatcher not found."));
    // Agency isolation: non-super-admins can only view their own agency's dispatchers
    if (req.user.role !== "SuperAdmin" && dispatcher.agencyId !== req.user.agencyId) {
      return res.status(403).json(error("Access denied."));
    }
    return res.json(success("Dispatcher retrieved.", dispatcher));
  } catch (err) { next(err); }
}

// ── Approve ───────────────────────────────────────────────────────────

async function approve(req, res, next) {
  try {
    const dispatcher = await dispatcherService.approveDispatcher(req.params.id, req.user.agencyId);
    if (!dispatcher) return res.status(404).json(error("Dispatcher not found or not pending."));
    return res.json(success("Dispatcher approved and activated.", dispatcher));
  } catch (err) { next(err); }
}

// ── Reject ────────────────────────────────────────────────────────────

async function reject(req, res, next) {
  try {
    const { reason } = rejectSchema.parse(req.body);
    const dispatcher = await dispatcherService.rejectDispatcher(req.params.id, req.user.agencyId, reason);
    if (!dispatcher) return res.status(404).json(error("Dispatcher not found or not pending."));
    return res.json(success("Dispatcher rejected.", dispatcher));
  } catch (err) { next(err); }
}

// ── Suspend ───────────────────────────────────────────────────────────

async function suspend(req, res, next) {
  try {
    const dispatcher = await dispatcherService.suspendDispatcher(req.params.id, req.user.agencyId);
    if (!dispatcher) return res.status(404).json(error("Dispatcher not found or not active."));
    return res.json(success("Dispatcher suspended.", dispatcher));
  } catch (err) { next(err); }
}

// ── Blocking loads ────────────────────────────────────────────────────

async function blockingLoads(req, res, next) {
  try {
    const loads = await dispatcherService.getBlockingLoads(req.params.id);
    return res.json(success("Blocking loads retrieved.", loads));
  } catch (err) { next(err); }
}

// ── Transfer: request ─────────────────────────────────────────────────

async function requestTransfer(req, res, next) {
  try {
    const { toAgencyId } = transferRequestSchema.parse(req.body);
    const result = await transferService.requestTransfer({ dispatcherId: req.user.userId, toAgencyId });
    if (result.error) {
      return res.status(400).json(error(result.error, result.blockingLoads || null));
    }
    return res.status(201).json(success("Transfer request submitted. You are now suspended pending approvals.", result.transfer));
  } catch (err) { next(err); }
}

// ── Transfer: approve ─────────────────────────────────────────────────

async function approveTransfer(req, res, next) {
  try {
    const result = await transferService.approveTransfer({
      transferId: req.params.id,
      approvingAgencyId: req.user.agencyId,
    });
    if (!result) return res.status(404).json(error("Transfer request not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success(result.message, { status: result.status }));
  } catch (err) { next(err); }
}

// ── Transfer: decline ─────────────────────────────────────────────────

async function declineTransfer(req, res, next) {
  try {
    const { reason } = declineTransferSchema.parse(req.body);
    const result = await transferService.declineTransfer({
      transferId: req.params.id,
      decliningAgencyId: req.user.agencyId,
      reason,
    });
    if (!result) return res.status(404).json(error("Transfer request not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success(result.message));
  } catch (err) { next(err); }
}

// ── Transfer: cancel ──────────────────────────────────────────────────

async function cancelTransfer(req, res, next) {
  try {
    const result = await transferService.cancelTransfer({
      transferId: req.params.id,
      dispatcherId: req.user.userId,
    });
    if (!result) return res.status(404).json(error("Transfer request not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success(result.message));
  } catch (err) { next(err); }
}

// ── Restoration: approve ──────────────────────────────────────────────

async function approveRestoration(req, res, next) {
  try {
    const result = await transferService.approveRestoration({
      dispatcherId: req.params.id,
      agencyId: req.user.agencyId,
    });
    if (!result) return res.status(404).json(error("Dispatcher not found or not in SUSPENDED_RESTORATION."));
    return res.json(success(result.message, result.dispatcher));
  } catch (err) { next(err); }
}

// ── Restoration: decline ──────────────────────────────────────────────

async function declineRestoration(req, res, next) {
  try {
    const { reason } = rejectSchema.parse(req.body);
    const result = await transferService.declineRestoration({
      dispatcherId: req.params.id,
      agencyId: req.user.agencyId,
      reason,
    });
    if (!result) return res.status(404).json(error("Dispatcher not found or not in SUSPENDED_RESTORATION."));
    return res.json(success(result.message, result.dispatcher));
  } catch (err) { next(err); }
}

// ── Join: request ──────────────────────────────────────────────────────

async function requestJoin(req, res, next) {
  try {
    const { agencyId } = joinRequestSchema.parse(req.body);
    const result = await transferService.requestJoin({ dispatcherId: req.user.userId, agencyId });
    if (result.error) return res.status(400).json(error(result.error));
    return res.status(201).json(success("Join request submitted.", result.joinRequest));
  } catch (err) { next(err); }
}

// ── Join: approve ──────────────────────────────────────────────────────

async function approveJoin(req, res, next) {
  try {
    const result = await transferService.approveJoin({
      joinRequestId: req.params.id,
      agencyId: req.user.agencyId,
    });
    if (!result) return res.status(404).json(error("Join request not found."));
    return res.json(success(result.message));
  } catch (err) { next(err); }
}

// ── Join: decline ──────────────────────────────────────────────────────

async function declineJoin(req, res, next) {
  try {
    const { reason } = rejectSchema.parse(req.body);
    const result = await transferService.declineJoin({
      joinRequestId: req.params.id,
      agencyId: req.user.agencyId,
      reason,
    });
    if (!result) return res.status(404).json(error("Join request not found."));
    return res.json(success(result.message));
  } catch (err) { next(err); }
}

// ── Performance ───────────────────────────────────────────────────────

async function performance(req, res, next) {
  try {
    const stats = await dispatcherService.getPerformanceStats(req.params.id);
    if (!stats) return res.status(404).json(error("Performance stats not found."));
    return res.json(success("Performance stats retrieved.", stats));
  } catch (err) { next(err); }
}

// ── Ratings: list ──────────────────────────────────────────────────────

async function listRatings(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const result = await dispatcherService.getDispatcherRatings(req.params.id, pagination);
    return res.json(success("Ratings retrieved.", paginate(result)));
  } catch (err) { next(err); }
}

// ── Ratings: submit ────────────────────────────────────────────────────

async function rate(req, res, next) {
  try {
    const data = rateSchema.parse(req.body);
    const rating = await dispatcherService.rateDispatcher({
      dispatcherId: req.params.id,
      authorId: req.user.userId,
      ...data,
    });
    return res.status(201).json(success("Rating submitted.", rating));
  } catch (err) { next(err); }
}

// ── Ratings: flag ──────────────────────────────────────────────────────

async function flagRating(req, res, next) {
  try {
    const { reason } = flagSchema.parse(req.body);
    const rating = await dispatcherService.flagRating(req.params.id, req.user.userId, reason);
    if (!rating) return res.status(404).json(error("Rating not found."));
    return res.json(success("Rating flagged.", rating));
  } catch (err) { next(err); }
}

// ── Ratings: respond ──────────────────────────────────────────────────

async function respondToRating(req, res, next) {
  try {
    const { response: resp } = respondSchema.parse(req.body);
    const result = await dispatcherService.respondToRating(req.params.id, req.user.userId, resp);
    if (!result) return res.status(404).json(error("Rating not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Response saved.", result));
  } catch (err) { next(err); }
}

module.exports = {
  invite, register, list, getById,
  approve, reject, suspend, blockingLoads,
  requestTransfer, approveTransfer, declineTransfer, cancelTransfer,
  approveRestoration, declineRestoration,
  requestJoin, approveJoin, declineJoin,
  performance, listRatings, rate, flagRating, respondToRating,
};
