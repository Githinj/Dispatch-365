const { error } = require("../utils/response.utils");

/**
 * Role-based access control.
 * Usage: authorize("SuperAdmin", "AgencyAdmin")
 */
function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) {
      return res.status(401).json(error("Authentication required."));
    }
    if (!allowedRoles.includes(req.user.role)) {
      return res.status(403).json(error("Insufficient permissions."));
    }
    next();
  };
}

// ── Financial field visibility matrix ────────────────────────────────
// Maps each sensitive field to the roles that are allowed to see it.

const FIELD_VISIBILITY = {
  loadRate:            ["SuperAdmin", "AgencyAdmin", "FleetAdmin", "Dispatcher"],
  commissionPercent:   ["SuperAdmin", "AgencyAdmin", "FleetAdmin"],
  commissionAmount:    ["SuperAdmin", "AgencyAdmin", "FleetAdmin"],
  dispatcherEarnings:  ["SuperAdmin", "AgencyAdmin", "Dispatcher"],
  fleetEarnings:       ["SuperAdmin", "AgencyAdmin", "FleetAdmin"],
  platformRevenue:     ["SuperAdmin"],
};

/**
 * Middleware that strips financial fields the requesting role must not see.
 * Works on res.json by wrapping it so every outgoing payload is filtered.
 */
function stripFinancialFields(req, res, next) {
  const role = req.user?.role;
  const originalJson = res.json.bind(res);

  res.json = (body) => {
    if (body && typeof body === "object") {
      const cleaned = stripFields(body, role);
      return originalJson(cleaned);
    }
    return originalJson(body);
  };

  next();
}

function stripFields(obj, role) {
  if (Array.isArray(obj)) {
    return obj.map((item) => stripFields(item, role));
  }
  if (obj !== null && typeof obj === "object") {
    const result = {};
    for (const [key, value] of Object.entries(obj)) {
      // If the key is a restricted field, check whether this role may see it
      if (FIELD_VISIBILITY[key]) {
        if (!FIELD_VISIBILITY[key].includes(role)) continue; // strip it
      }
      result[key] = stripFields(value, role);
    }
    return result;
  }
  return obj;
}

module.exports = { authorize, stripFinancialFields, FIELD_VISIBILITY };
