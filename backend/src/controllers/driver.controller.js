const { z } = require("zod");
const driverService = require("../services/driver.service");
const transferService = require("../services/driver-transfer.service");
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
  profilePhotoUrl: z.string().url("Profile photo URL required."),
  licenseNumber: z.string().min(1, "License number required."),
  licenseUrl: z.string().url("Driver license copy URL required."),
  licenseExpiry: z.coerce.date({ required_error: "License expiry date required." }),
  medicalCertificateUrl: z.string().url().optional(),
  hazmatCertificationUrl: z.string().url().optional(),
  backgroundCheckUrl: z.string().url().optional(),
});

const rejectSchema = z.object({
  reason: z.string().min(3),
});

const transferRequestSchema = z.object({
  toFleetId: z.string().uuid(),
});

const declineSchema = z.object({
  reason: z.string().min(3),
});

const joinRequestSchema = z.object({
  fleetId: z.string().uuid(),
  reasonForLeaving: z.string().optional(),
});

// ── Invite ────────────────────────────────────────────────────────────

async function invite(req, res, next) {
  try {
    const data = inviteSchema.parse(req.body);
    const result = await driverService.inviteDriver({
      ...data,
      fleetId: req.user.fleetId,
      agencyId: req.user.agencyId || null,
    });
    if (result.error) return res.status(400).json(error(result.error));
    return res.status(201).json(success("Driver invited.", { id: result.user.id, inviteToken: result.inviteToken }));
  } catch (err) { next(err); }
}

// ── Register ──────────────────────────────────────────────────────────

async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body);
    const result = await driverService.registerDriver(req.params.inviteToken, data);
    if (result.error) return res.status(400).json(error(result.error));
    return res.status(201).json(success("Registration complete. Awaiting fleet approval.", result.user));
  } catch (err) { next(err); }
}

// ── List ──────────────────────────────────────────────────────────────

async function list(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const result = await driverService.listDrivers({
      fleetId: req.user.fleetId,
      status: req.query.status,
      ...pagination,
    });
    return res.json(success("Drivers retrieved.", paginate(result)));
  } catch (err) { next(err); }
}

// ── Available drivers ─────────────────────────────────────────────────

async function available(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    // Dispatchers query by fleetId param; FleetAdmin uses their own fleetId
    const fleetId = req.query.fleetId || req.user.fleetId;
    if (!fleetId) return res.status(400).json(error("fleetId query parameter required."));
    const result = await driverService.listAvailableDrivers({ fleetId, ...pagination });
    return res.json(success("Available drivers retrieved.", paginate(result)));
  } catch (err) { next(err); }
}

// ── Get by ID ─────────────────────────────────────────────────────────

async function getById(req, res, next) {
  try {
    const driver = await driverService.getDriverById(req.params.id);
    if (!driver) return res.status(404).json(error("Driver not found."));

    // Fleet isolation: FleetAdmin can only view their own fleet's drivers
    if (req.user.role === "FleetAdmin" && driver.fleetId !== req.user.fleetId) {
      return res.status(403).json(error("Access denied."));
    }
    // Driver can only view themselves
    if (req.user.role === "Driver" && driver.id !== req.user.userId) {
      return res.status(403).json(error("Access denied."));
    }

    return res.json(success("Driver retrieved.", driver));
  } catch (err) { next(err); }
}

// ── Approve ───────────────────────────────────────────────────────────

async function approve(req, res, next) {
  try {
    const driver = await driverService.approveDriver(req.params.id, req.user.fleetId);
    if (!driver) return res.status(404).json(error("Driver not found or not pending."));
    return res.json(success("Driver approved and activated.", driver));
  } catch (err) { next(err); }
}

// ── Reject ────────────────────────────────────────────────────────────

async function reject(req, res, next) {
  try {
    const { reason } = rejectSchema.parse(req.body);
    const driver = await driverService.rejectDriver(req.params.id, req.user.fleetId, reason);
    if (!driver) return res.status(404).json(error("Driver not found or not pending."));
    return res.json(success("Driver rejected.", driver));
  } catch (err) { next(err); }
}

// ── Suspend ───────────────────────────────────────────────────────────

async function suspend(req, res, next) {
  try {
    const driver = await driverService.suspendDriver(req.params.id, req.user.fleetId);
    if (!driver) return res.status(404).json(error("Driver not found or not active."));
    return res.json(success("Driver suspended.", driver));
  } catch (err) { next(err); }
}

// ── Blocking loads ────────────────────────────────────────────────────

async function blockingLoads(req, res, next) {
  try {
    const loads = await driverService.getBlockingLoads(req.params.id);
    return res.json(success("Blocking loads retrieved.", loads));
  } catch (err) { next(err); }
}

// ── Transfer: request ─────────────────────────────────────────────────

async function requestTransfer(req, res, next) {
  try {
    const { toFleetId } = transferRequestSchema.parse(req.body);
    const result = await transferService.requestTransfer({ driverId: req.user.userId, toFleetId });
    if (result.error) {
      return res.status(400).json(error(result.error, result.blockingLoads || null));
    }
    return res.status(201).json(success("Transfer request submitted. Session ended.", result.transfer));
  } catch (err) { next(err); }
}

// ── Transfer: approve ─────────────────────────────────────────────────

async function approveTransfer(req, res, next) {
  try {
    const result = await transferService.approveTransfer({
      transferId: req.params.id,
      approvingFleetId: req.user.fleetId,
    });
    if (!result) return res.status(404).json(error("Transfer request not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success(result.message, { status: result.status }));
  } catch (err) { next(err); }
}

// ── Transfer: decline ─────────────────────────────────────────────────

async function declineTransfer(req, res, next) {
  try {
    const { reason } = declineSchema.parse(req.body);
    const result = await transferService.declineTransfer({
      transferId: req.params.id,
      decliningFleetId: req.user.fleetId,
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
      driverId: req.user.userId,
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
      driverId: req.params.id,
      fleetId: req.user.fleetId,
    });
    if (!result) return res.status(404).json(error("Driver not found or not in SUSPENDED_RESTORATION."));
    return res.json(success(result.message, result.driver));
  } catch (err) { next(err); }
}

// ── Restoration: decline ──────────────────────────────────────────────

async function declineRestoration(req, res, next) {
  try {
    const { reason } = rejectSchema.parse(req.body);
    const result = await transferService.declineRestoration({
      driverId: req.params.id,
      fleetId: req.user.fleetId,
      reason,
    });
    if (!result) return res.status(404).json(error("Driver not found or not in SUSPENDED_RESTORATION."));
    return res.json(success(result.message, result.driver));
  } catch (err) { next(err); }
}

// ── Join: request ─────────────────────────────────────────────────────

async function requestJoin(req, res, next) {
  try {
    const { fleetId, reasonForLeaving } = joinRequestSchema.parse(req.body);
    const result = await transferService.requestJoin({
      driverId: req.user.userId,
      fleetId,
      reasonForLeaving,
    });
    if (result.error) return res.status(400).json(error(result.error));
    return res.status(201).json(success("Join request submitted.", result.joinRequest));
  } catch (err) { next(err); }
}

// ── Join: approve ─────────────────────────────────────────────────────

async function approveJoin(req, res, next) {
  try {
    const result = await transferService.approveJoin({
      joinRequestId: req.params.id,
      fleetId: req.user.fleetId,
    });
    if (!result) return res.status(404).json(error("Join request not found."));
    return res.json(success(result.message));
  } catch (err) { next(err); }
}

// ── Join: decline ─────────────────────────────────────────────────────

async function declineJoin(req, res, next) {
  try {
    const { reason } = rejectSchema.parse(req.body);
    const result = await transferService.declineJoin({
      joinRequestId: req.params.id,
      fleetId: req.user.fleetId,
      reason,
    });
    if (!result) return res.status(404).json(error("Join request not found."));
    return res.json(success(result.message));
  } catch (err) { next(err); }
}

// ── Performance ───────────────────────────────────────────────────────

async function performance(req, res, next) {
  try {
    const stats = await driverService.getPerformanceStats(req.params.id);
    if (!stats) return res.status(404).json(error("Performance stats not found."));
    return res.json(success("Performance stats retrieved.", stats));
  } catch (err) { next(err); }
}

// ── Driver load history (mobile) ──────────────────────────────────────

async function driverLoads(req, res, next) {
  try {
    // Driver can only see their own loads
    const targetId = req.user.role === "Driver" ? req.user.userId : req.params.id;
    const pagination = parsePagination(req.query);
    const result = await driverService.getDriverLoads(targetId, pagination);
    return res.json(success("Load history retrieved.", paginate(result)));
  } catch (err) { next(err); }
}

module.exports = {
  invite, register, list, available, getById,
  approve, reject, suspend, blockingLoads,
  requestTransfer, approveTransfer, declineTransfer, cancelTransfer,
  approveRestoration, declineRestoration,
  requestJoin, approveJoin, declineJoin,
  performance, driverLoads,
};
