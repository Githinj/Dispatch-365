/**
 * Agency / fleet isolation middleware.
 * Injects `req.isolation` on every request based on the authenticated user's
 * role, agencyId, and fleetId.  Downstream queries should spread req.isolation
 * into their Prisma `where` clauses to enforce data boundaries.
 *
 * Isolation rules:
 *   SuperAdmin    → no filter (sees everything)
 *   AgencyAdmin   → { agencyId }
 *   FleetAdmin    → { agencyId, fleetId }
 *   Dispatcher    → { agencyId }
 *   Driver        → { agencyId, fleetId }
 */
function isolate(req, _res, next) {
  req.isolation = {};

  if (!req.user) return next();

  const { role, agencyId, fleetId } = req.user;

  switch (role) {
    case "SuperAdmin":
      // No filter — full access
      break;

    case "AgencyAdmin":
    case "Dispatcher":
      if (agencyId) req.isolation.agencyId = agencyId;
      break;

    case "FleetAdmin":
    case "Driver":
      if (agencyId) req.isolation.agencyId = agencyId;
      if (fleetId) req.isolation.fleetId = fleetId;
      break;

    default:
      if (agencyId) req.isolation.agencyId = agencyId;
      break;
  }

  next();
}

module.exports = { isolate };
