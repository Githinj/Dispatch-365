const { z } = require("zod");
const vehicleService = require("../services/vehicle.service");
const { success, error, paginate, parsePagination } = require("../utils/response.utils");

// ── Validation schemas ───────────────────────────────────────────────

const VEHICLE_TYPES = ["SEMI", "FLATBED", "REEFER", "BOX_TRUCK", "TANKER", "OTHER"];
const MAINTENANCE_TYPES = ["ROUTINE", "REPAIR", "INSPECTION"];

const createVehicleSchema = z.object({
  make: z.string().min(1),
  model: z.string().min(1),
  year: z.number().int().min(1900).max(new Date().getFullYear() + 1),
  vehicleType: z.enum(VEHICLE_TYPES),
  plateNumber: z.string().min(1),
  vin: z.string().min(1).optional(),
  capacityTons: z.number().positive().optional(),
  insuranceExpiry: z.coerce.date().optional(),
  inspectionExpiry: z.coerce.date().optional(),
});

const updateVehicleSchema = z.object({
  make: z.string().min(1).optional(),
  model: z.string().min(1).optional(),
  year: z.number().int().min(1900).max(new Date().getFullYear() + 1).optional(),
  vehicleType: z.enum(VEHICLE_TYPES).optional(),
  plateNumber: z.string().min(1).optional(),
  vin: z.string().min(1).optional(),
  capacityTons: z.number().positive().optional(),
  insuranceExpiry: z.coerce.date().optional(),
  inspectionExpiry: z.coerce.date().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "At least one field must be provided." });

const startMaintenanceSchema = z.object({
  type: z.enum(MAINTENANCE_TYPES),
  description: z.string().min(3),
  notes: z.string().optional(),
  cost: z.number().positive().optional(),
  scheduledDate: z.coerce.date().optional(),
});

const completeMaintenanceSchema = z.object({
  notes: z.string().optional(),
  cost: z.number().positive().optional(),
});

// ── Create ────────────────────────────────────────────────────────────

async function create(req, res, next) {
  try {
    const data = createVehicleSchema.parse(req.body);
    const result = await vehicleService.createVehicle({ ...data, fleetId: req.user.fleetId });
    if (result.error) return res.status(400).json(error(result.error));
    return res.status(201).json(success("Vehicle created.", result.vehicle));
  } catch (err) { next(err); }
}

// ── List ──────────────────────────────────────────────────────────────

async function list(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const result = await vehicleService.listVehicles({
      fleetId: req.user.fleetId,
      status: req.query.status,
      ...pagination,
    });
    return res.json(success("Vehicles retrieved.", paginate(result)));
  } catch (err) { next(err); }
}

// ── Available vehicles ────────────────────────────────────────────────

async function available(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const fleetId = req.query.fleetId || req.user.fleetId;
    if (!fleetId) return res.status(400).json(error("fleetId query parameter required."));
    const result = await vehicleService.listAvailableVehicles({ fleetId, ...pagination });
    return res.json(success("Available vehicles retrieved.", paginate(result)));
  } catch (err) { next(err); }
}

// ── Expiring documents ────────────────────────────────────────────────

async function expiringDocuments(req, res, next) {
  try {
    const withinDays = req.query.withinDays ? parseInt(req.query.withinDays, 10) : 30;
    const vehicles = await vehicleService.getExpiringDocuments(withinDays);
    return res.json(success("Vehicles with expiring documents retrieved.", vehicles));
  } catch (err) { next(err); }
}

// ── Get by ID ─────────────────────────────────────────────────────────

async function getById(req, res, next) {
  try {
    const vehicle = await vehicleService.getVehicleById(req.params.id);
    if (!vehicle) return res.status(404).json(error("Vehicle not found."));

    // FleetAdmin can only view their own fleet's vehicles
    if (req.user.role === "FleetAdmin" && vehicle.fleetId !== req.user.fleetId) {
      return res.status(403).json(error("Access denied."));
    }

    return res.json(success("Vehicle retrieved.", vehicle));
  } catch (err) { next(err); }
}

// ── Update ────────────────────────────────────────────────────────────

async function update(req, res, next) {
  try {
    const data = updateVehicleSchema.parse(req.body);
    const vehicle = await vehicleService.updateVehicle(req.params.id, req.user.fleetId, data);
    if (!vehicle) return res.status(404).json(error("Vehicle not found."));
    return res.json(success("Vehicle updated.", vehicle));
  } catch (err) { next(err); }
}

// ── Retire ────────────────────────────────────────────────────────────

async function retire(req, res, next) {
  try {
    const result = await vehicleService.retireVehicle(req.params.id, req.user.fleetId);
    if (!result) return res.status(404).json(error("Vehicle not found or already inactive."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Vehicle retired.", result));
  } catch (err) { next(err); }
}

// ── Maintenance: start ────────────────────────────────────────────────

async function maintenanceStart(req, res, next) {
  try {
    const data = startMaintenanceSchema.parse(req.body);
    const result = await vehicleService.startMaintenance(req.params.id, req.user.fleetId, {
      ...data,
      createdById: req.user.userId,
    });
    if (!result) return res.status(404).json(error("Vehicle not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.status(201).json(success("Maintenance started. Vehicle marked UNDER_MAINTENANCE.", result.record));
  } catch (err) { next(err); }
}

// ── Maintenance: complete ─────────────────────────────────────────────

async function maintenanceComplete(req, res, next) {
  try {
    const data = completeMaintenanceSchema.parse(req.body);
    const result = await vehicleService.completeMaintenance(
      req.params.id,
      req.user.fleetId,
      req.params.recordId,
      data,
    );
    if (!result) return res.status(404).json(error("Vehicle not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Maintenance completed. Vehicle restored to AVAILABLE.", result.record));
  } catch (err) { next(err); }
}

// ── Maintenance: history ──────────────────────────────────────────────

async function maintenanceHistory(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const result = await vehicleService.getMaintenanceHistory(req.params.id, pagination);
    return res.json(success("Maintenance history retrieved.", paginate(result)));
  } catch (err) { next(err); }
}

module.exports = {
  create,
  list,
  available,
  expiringDocuments,
  getById,
  update,
  retire,
  maintenanceStart,
  maintenanceComplete,
  maintenanceHistory,
};
