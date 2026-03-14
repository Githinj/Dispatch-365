const path = require("path");
const multer = require("multer");
const { z } = require("zod");
const loadService = require("../services/load.service");
const lifecycleService = require("../services/load-lifecycle.service");
const { success, error, paginate, parsePagination } = require("../utils/response.utils");

// ── POD upload middleware ─────────────────────────────────────────────

const ALLOWED_POD_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_POD_BYTES = 10 * 1024 * 1024; // 10 MB

const podStorage = multer.diskStorage({
  destination: path.join(__dirname, "../../uploads/pod"),
  filename: (_req, file, cb) => {
    const safeName = file.originalname.replace(/\s+/g, "_").replace(/[^a-zA-Z0-9._-]/g, "");
    cb(null, `${Date.now()}-${safeName}`);
  },
});

const multerUpload = multer({
  storage: podStorage,
  limits: { fileSize: MAX_POD_BYTES },
  fileFilter: (_req, file, cb) => {
    if (ALLOWED_POD_MIME_TYPES.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only JPG, PNG, and PDF files are allowed for POD upload."));
    }
  },
});

/**
 * Wraps multer so that file-type and size errors are forwarded to the
 * Express error handler (instead of being swallowed silently).
 */
const uploadPodMiddleware = (req, res, next) => {
  multerUpload.single("pod")(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      const msg =
        err.code === "LIMIT_FILE_SIZE"
          ? "POD file exceeds the 10 MB limit."
          : err.message;
      return res.status(400).json(error(msg));
    }
    if (err) return res.status(400).json(error(err.message));
    next();
  });
};

// ── Validation schemas ────────────────────────────────────────────────

const createLoadSchema = z.object({
  fleetId: z.string().uuid().optional(),
  driverId: z.string().uuid().optional(),
  vehicleId: z.string().uuid().optional(),
  origin: z.string().min(3, "Origin (pickup location) is required."),
  destination: z.string().min(3, "Destination (dropoff location) is required."),
  pickupDate: z.coerce.date().optional(),
  deliveryDate: z.coerce.date().optional(),
  loadRate: z.number().positive("Load rate must be a positive number."),
  commodity: z.string().optional(),
  weight: z.number().positive().optional(),
  notes: z.string().optional(),
});

const updateLoadSchema = z
  .object({
    fleetId: z.string().uuid().optional(),
    driverId: z.string().uuid().optional(),
    vehicleId: z.string().uuid().optional(),
    origin: z.string().min(3).optional(),
    destination: z.string().min(3).optional(),
    pickupDate: z.coerce.date().optional(),
    deliveryDate: z.coerce.date().optional(),
    loadRate: z.number().positive().optional(),
    commodity: z.string().optional(),
    weight: z.number().positive().optional(),
    notes: z.string().optional(),
  })
  .refine((d) => Object.keys(d).length > 0, { message: "At least one field must be provided." });

const cancelSchema = z.object({
  reason: z.string().min(3, "Cancellation reason is required."),
});

const rejectDeliverySchema = z.object({
  reason: z.string().min(3, "Rejection reason is required."),
});

// ── Create ────────────────────────────────────────────────────────────

async function create(req, res, next) {
  try {
    const data = createLoadSchema.parse(req.body);
    const result = await loadService.createLoad({
      ...data,
      dispatcherId: req.user.userId,
      agencyId: req.user.agencyId,
    });
    if (result.error) return res.status(400).json(error(result.error));
    return res.status(201).json(success("Load created.", result.load));
  } catch (err) {
    next(err);
  }
}

// ── List ──────────────────────────────────────────────────────────────

async function list(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const result = await loadService.listLoads({
      isolation: req.isolation,
      role: req.user.role,
      userId: req.user.userId,
      status: req.query.status,
      fleetId: req.query.fleetId,
      driverId: req.query.driverId,
      dispatcherId: req.query.dispatcherId,
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      origin: req.query.origin,
      destination: req.query.destination,
      ...pagination,
    });
    return res.json(success("Loads retrieved.", paginate(result)));
  } catch (err) {
    next(err);
  }
}

// ── Get by ID ─────────────────────────────────────────────────────────

async function getById(req, res, next) {
  try {
    const load = await loadService.getLoadById(req.params.id);
    if (!load) return res.status(404).json(error("Load not found."));

    // Isolation checks beyond what the middleware enforces
    if (req.isolation.agencyId && load.agencyId !== req.isolation.agencyId) {
      return res.status(403).json(error("Access denied."));
    }
    if (req.user.role === "FleetAdmin" && load.fleetId !== req.user.fleetId) {
      return res.status(403).json(error("Access denied."));
    }
    if (req.user.role === "Driver" && load.driverId !== req.user.userId) {
      return res.status(403).json(error("Access denied."));
    }

    return res.json(success("Load retrieved.", load));
  } catch (err) {
    next(err);
  }
}

// ── Update DRAFT load ─────────────────────────────────────────────────

async function update(req, res, next) {
  try {
    const data = updateLoadSchema.parse(req.body);
    const result = await loadService.updateDraftLoad(req.params.id, req.user.userId, data);
    if (!result) return res.status(404).json(error("Load not found or not in DRAFT status."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Load updated.", result.load));
  } catch (err) {
    next(err);
  }
}

// ── Cancel ────────────────────────────────────────────────────────────

async function cancel(req, res, next) {
  try {
    const { reason } = cancelSchema.parse(req.body);
    const result = await lifecycleService.cancelLoad(
      req.params.id,
      req.user.userId,
      req.user.role,
      reason
    );
    if (!result) return res.status(404).json(error("Load not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Load cancelled.", null));
  } catch (err) {
    next(err);
  }
}

// ── Start trip (Driver) ───────────────────────────────────────────────

async function startTrip(req, res, next) {
  try {
    const result = await lifecycleService.startTrip(req.params.id, req.user.userId);
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Trip started. Load is now IN_TRANSIT.", null));
  } catch (err) {
    next(err);
  }
}

// ── Deliver (Driver — multipart/form-data with POD file) ──────────────

async function deliver(req, res, next) {
  try {
    if (!req.file) return res.status(400).json(error("POD file is required."));

    // Build accessible URL. In production swap for the S3/R2 URL returned by the upload SDK.
    const podUrl = `${process.env.API_BASE_URL || ""}/uploads/pod/${req.file.filename}`;

    const result = await lifecycleService.markDelivered(req.params.id, req.user.userId, podUrl);
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Delivery submitted. Awaiting dispatcher confirmation.", { podUrl }));
  } catch (err) {
    next(err);
  }
}

// ── Accept delivery (Dispatcher) ─────────────────────────────────────

async function acceptDelivery(req, res, next) {
  try {
    const result = await lifecycleService.acceptDelivery(req.params.id, req.user.userId);
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Delivery accepted. Load marked COMPLETED.", null));
  } catch (err) {
    next(err);
  }
}

// ── Reject delivery (Dispatcher) ─────────────────────────────────────

async function rejectDelivery(req, res, next) {
  try {
    const { reason } = rejectDeliverySchema.parse(req.body);
    const result = await lifecycleService.rejectDelivery(req.params.id, req.user.userId, reason);
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Delivery rejected. Driver must re-upload POD.", null));
  } catch (err) {
    next(err);
  }
}

// ── Status history ────────────────────────────────────────────────────

async function statusHistory(req, res, next) {
  try {
    const history = await loadService.getStatusHistory(req.params.id);
    return res.json(success("Status history retrieved.", history));
  } catch (err) {
    next(err);
  }
}

// ── POD URL ───────────────────────────────────────────────────────────

async function pod(req, res, next) {
  try {
    const load = await loadService.getLoadById(req.params.id);
    if (!load) return res.status(404).json(error("Load not found."));
    if (!load.podUrl) return res.status(404).json(error("No POD file uploaded for this load."));

    // Apply role-based access: driver sees only their own load's POD
    if (req.user.role === "Driver" && load.driverId !== req.user.userId) {
      return res.status(403).json(error("Access denied."));
    }

    return res.json(success("POD URL retrieved.", { podUrl: load.podUrl }));
  } catch (err) {
    next(err);
  }
}

// ── Dispatcher blocking loads ─────────────────────────────────────────

async function blockingLoads(req, res, next) {
  try {
    const dispatcherId = req.params.id;

    // Dispatchers may only query their own blocking loads
    if (req.user.role === "Dispatcher" && dispatcherId !== req.user.userId) {
      return res.status(403).json(error("Access denied."));
    }

    const loads = await loadService.getDispatcherBlockingLoads(dispatcherId);
    return res.json(success("Blocking loads retrieved.", loads));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  create,
  list,
  getById,
  update,
  cancel,
  startTrip,
  deliver,
  acceptDelivery,
  rejectDelivery,
  statusHistory,
  pod,
  blockingLoads,
  uploadPodMiddleware,
};
