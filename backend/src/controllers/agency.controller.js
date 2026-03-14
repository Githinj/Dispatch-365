const { z } = require("zod");
const agencyService = require("../services/agency.service");
const { success, error, paginate, parsePagination } = require("../utils/response.utils");

// ── Validation schemas ───────────────────────────────────────────────

const createAgencySchema = z.object({
  name: z.string().min(2, "Agency name must be at least 2 characters."),
  logoUrl: z.string().url().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  footerText: z.string().optional(),
  commissionPercent: z.number().min(0).max(100).optional(),
  paymentTermsDays: z.number().int().min(1).optional(),
  subscriptionPlan: z.enum(["FREE", "BASIC", "PRO", "ENTERPRISE"]).optional(),
});

const updateAgencySchema = z.object({
  name: z.string().min(2).optional(),
  logoUrl: z.string().url().nullable().optional(),
  primaryColor: z.string().optional(),
  secondaryColor: z.string().optional(),
  footerText: z.string().nullable().optional(),
  commissionPercent: z.number().min(0).max(100).optional(),
  paymentTermsDays: z.number().int().min(1).optional(),
  // subscriptionPlan intentionally NOT here — managed via dedicated SuperAdmin endpoint
});

const updateSubscriptionSchema = z.object({
  subscriptionPlan: z.enum(["FREE", "BASIC", "PRO", "ENTERPRISE"]),
});

// ── Handlers ─────────────────────────────────────────────────────────

/** POST /api/agencies — SuperAdmin creates a new agency */
async function create(req, res, next) {
  try {
    const data = createAgencySchema.parse(req.body);
    const agency = await agencyService.createAgency(data);
    return res.status(201).json(success("Agency created.", agency));
  } catch (err) {
    next(err);
  }
}

/** GET /api/agencies — list agencies (scoped) */
async function list(req, res, next) {
  try {
    const pagination = parsePagination(req.query);
    const result = await agencyService.listAgencies({
      ...pagination,
      isolation: req.isolation,
    });
    return res.json(success("Agencies retrieved.", paginate(result)));
  } catch (err) {
    next(err);
  }
}

/** GET /api/agencies/:id — get single agency */
async function getById(req, res, next) {
  try {
    const agency = await agencyService.getAgencyById(req.params.id, req.isolation);
    if (!agency) return res.status(404).json(error("Agency not found."));
    return res.json(success("Agency retrieved.", agency));
  } catch (err) {
    next(err);
  }
}

/** PUT /api/agencies/:id — update agency (AgencyAdmin own, SuperAdmin any) */
async function update(req, res, next) {
  try {
    const data = updateAgencySchema.parse(req.body);
    const agency = await agencyService.updateAgency(req.params.id, data, req.isolation);
    if (!agency) return res.status(404).json(error("Agency not found."));
    return res.json(success("Agency updated.", agency));
  } catch (err) {
    next(err);
  }
}

/** PATCH /api/agencies/:id/subscription — SuperAdmin only */
async function updateSubscription(req, res, next) {
  try {
    const { subscriptionPlan } = updateSubscriptionSchema.parse(req.body);
    const agency = await agencyService.updateAgency(req.params.id, { subscriptionPlan });
    if (!agency) return res.status(404).json(error("Agency not found."));
    return res.json(success("Subscription updated.", agency));
  } catch (err) {
    next(err);
  }
}

/** POST /api/agencies/:id/suspend — SuperAdmin only */
async function suspend(req, res, next) {
  try {
    const agency = await agencyService.suspendAgency(req.params.id);
    if (!agency) return res.status(404).json(error("Agency not found."));
    return res.json(success("Agency suspended. All user sessions invalidated.", agency));
  } catch (err) {
    next(err);
  }
}

/** POST /api/agencies/:id/reactivate — SuperAdmin only */
async function reactivate(req, res, next) {
  try {
    const agency = await agencyService.reactivateAgency(req.params.id);
    if (!agency) return res.status(404).json(error("Agency not found."));
    return res.json(success("Agency reactivated.", agency));
  } catch (err) {
    next(err);
  }
}

module.exports = {
  create,
  list,
  getById,
  update,
  updateSubscription,
  suspend,
  reactivate,
};
