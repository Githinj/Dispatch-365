const { z } = require("zod");
const fleetService = require("../services/fleet.service");
const { success, error, paginate, parsePagination } = require("../utils/response.utils");

// ── Validation schemas ───────────────────────────────────────────────

const inviteSchema = z.object({
  fleetName: z.string().min(2, "Fleet name must be at least 2 characters."),
  contactEmail: z.string().email("Valid email is required."),
});

const registerSchema = z.object({
  name: z.string().min(2).optional(),
  contactPhone: z.string().min(5).optional(),
  businessRegistrationUrl: z.string().url("Business Registration Certificate URL required."),
  operatingLicenseUrl: z.string().url("Operating License URL required."),
  operatingLicenseExpiry: z.coerce.date({ required_error: "Operating License expiry date required." }),
  insuranceCertificateUrl: z.string().url("Insurance Certificate URL required."),
  insuranceCertificateExpiry: z.coerce.date({ required_error: "Insurance Certificate expiry date required." }),
});

const updateFleetSchema = z.object({
  name: z.string().min(2).optional(),
  contactEmail: z.string().email().optional(),
  contactPhone: z.string().min(5).optional(),
  businessRegistrationUrl: z.string().url().optional(),
  operatingLicenseUrl: z.string().url().optional(),
  operatingLicenseExpiry: z.coerce.date().optional(),
  insuranceCertificateUrl: z.string().url().optional(),
  insuranceCertificateExpiry: z.coerce.date().optional(),
});

const rejectSchema = z.object({
  reason: z.string().min(5, "Rejection reason must be at least 5 characters."),
});

// ── Handlers ─────────────────────────────────────────────────────────

/** POST /api/fleets/invite — Agency Admin invites a fleet */
async function invite(req, res, next) {
  try {
    const data = inviteSchema.parse(req.body);
    const fleet = await fleetService.inviteFleet({
      ...data,
      agencyId: req.user.agencyId,
    });
    return res.status(201).json(success("Fleet invitation sent.", fleet));
  } catch (err) {
    next(err);
  }
}

/** POST /api/fleets/register/:inviteToken — Fleet registers after invite */
async function register(req, res, next) {
  try {
    const data = registerSchema.parse(req.body);
    const result = await fleetService.registerFleet(req.params.inviteToken, data);

    if (result.error) {
      return res.status(400).json(error(result.error));
    }

    return res.status(201).json(success("Fleet registration submitted. Awaiting approval.", result.fleet));
  } catch (err) {
    next(err);
  }
}

/** GET /api/fleets/pending — SuperAdmin sees pending approvals */
async function listPending(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const result = await fleetService.listPendingFleets(pagination);
    return res.json(success("Pending fleets retrieved.", paginate(result)));
  } catch (err) {
    next(err);
  }
}

/** POST /api/fleets/:id/approve — SuperAdmin approves */
async function approve(req, res, next) {
  try {
    const result = await fleetService.approveFleet(req.params.id);
    if (!result) return res.status(404).json(error("Fleet not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Fleet approved. Agency relationships created.", result));
  } catch (err) {
    next(err);
  }
}

/** POST /api/fleets/:id/reject — SuperAdmin rejects with reason */
async function reject(req, res, next) {
  try {
    const { reason } = rejectSchema.parse(req.body);
    const result = await fleetService.rejectFleet(req.params.id, reason);
    if (!result) return res.status(404).json(error("Fleet not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Fleet rejected. Fleet Admin can resubmit with corrections.", result));
  } catch (err) {
    next(err);
  }
}

/** GET /api/fleets — SuperAdmin sees all fleets */
async function listAll(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const status = req.query.status || undefined;
    const result = await fleetService.listAllFleets({ ...pagination, status });
    return res.json(success("Fleets retrieved.", paginate(result)));
  } catch (err) {
    next(err);
  }
}

/** GET /api/fleets/my-fleets — Agency Admin sees their fleet relationships */
async function myFleets(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const result = await fleetService.listAgencyFleets({
      agencyId: req.user.agencyId,
      ...pagination,
    });
    return res.json(success("Agency fleets retrieved.", paginate(result)));
  } catch (err) {
    next(err);
  }
}

/** GET /api/fleets/:id — Fleet Admin sees own fleet profile */
async function getById(req, res, next) {
  try {
    const fleet = await fleetService.getFleetById(req.params.id);
    if (!fleet) return res.status(404).json(error("Fleet not found."));

    // Fleet Admin can only view their own fleet
    if (req.user.role === "FleetAdmin" && req.user.fleetId !== fleet.id) {
      return res.status(403).json(error("Access denied."));
    }

    return res.json(success("Fleet retrieved.", fleet));
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/fleets/:id — Fleet Admin updates own profile */
async function update(req, res, next) {
  try {
    // Fleet Admin can only update their own fleet
    if (req.user.role === "FleetAdmin" && req.user.fleetId !== req.params.id) {
      return res.status(403).json(error("Access denied."));
    }

    const data = updateFleetSchema.parse(req.body);
    const fleet = await fleetService.updateFleet(req.params.id, data);
    if (!fleet) return res.status(404).json(error("Fleet not found."));
    return res.json(success("Fleet updated.", fleet));
  } catch (err) {
    next(err);
  }
}

/** POST /api/fleets/:id/suspend — SuperAdmin suspends */
async function suspend(req, res, next) {
  try {
    const result = await fleetService.suspendFleet(req.params.id);
    if (!result) return res.status(404).json(error("Fleet not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Fleet suspended. All fleet user sessions invalidated.", result));
  } catch (err) {
    next(err);
  }
}

/** POST /api/fleets/:id/reactivate — SuperAdmin reactivates */
async function reactivate(req, res, next) {
  try {
    const result = await fleetService.reactivateFleet(req.params.id);
    if (!result) return res.status(404).json(error("Fleet not found."));
    if (result.error) return res.status(400).json(error(result.error));
    return res.json(success("Fleet reactivated.", result));
  } catch (err) {
    next(err);
  }
}

/** GET /api/fleets/expiring-documents — SuperAdmin sees expiring documents */
async function expiringDocuments(req, res, next) {
  try {
    const days = parseInt(req.query.days, 10) || 30;
    const results = await fleetService.getExpiringDocuments(days);
    return res.json(success("Expiring documents retrieved.", results));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  invite,
  register,
  listPending,
  approve,
  reject,
  listAll,
  myFleets,
  getById,
  update,
  suspend,
  reactivate,
  expiringDocuments,
};
