const { prisma } = require("../services/prisma.service");

// HTTP methods that represent mutations
const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Audit middleware — logs every mutation to the `audit_logs` table.
 * Audit records are immutable (no update / delete operations exposed).
 *
 * Captures: userId, action (METHOD + path), resource, IP, timestamp,
 * and a snapshot of the request body (excluding passwords).
 */
function audit(req, res, next) {
  if (!MUTATION_METHODS.has(req.method)) return next();

  // Hook into res.finish to log *after* the response status is determined
  res.on("finish", async () => {
    try {
      const userId = req.user?.userId || null;
      const action = `${req.method} ${req.originalUrl}`;
      const resource = deriveResource(req.originalUrl);
      const statusCode = res.statusCode;

      // Sanitise body — never log passwords
      const payload = sanitiseBody(req.body);

      await prisma.auditLog.create({
        data: {
          userId,
          action,
          resource,
          statusCode,
          ip: req.ip,
          payload: payload ? JSON.stringify(payload) : undefined,
        },
      });
    } catch (err) {
      // Audit failures must not break the request — log and move on
      console.error("[Audit] Failed to write audit log:", err.message);
    }
  });

  next();
}

/** Derive a human-readable resource name from the URL path. */
function deriveResource(url) {
  const segments = url.split("?")[0].split("/").filter(Boolean);
  // e.g. /api/loads/123 → "loads"
  return segments[1] || segments[0] || "unknown";
}

/** Remove sensitive fields from the body snapshot. */
function sanitiseBody(body) {
  if (!body || typeof body !== "object") return body;
  const copy = { ...body };
  const sensitiveKeys = ["password", "newPassword", "currentPassword", "token", "secret"];
  for (const key of sensitiveKeys) {
    if (key in copy) copy[key] = "[REDACTED]";
  }
  return copy;
}

module.exports = { audit };
