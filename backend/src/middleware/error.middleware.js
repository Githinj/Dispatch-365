const { Prisma } = require("@prisma/client");
const { ZodError } = require("zod");
const { JsonWebTokenError, TokenExpiredError } = require("jsonwebtoken");
const { error: errorResponse } = require("../utils/response.utils");

/**
 * Global error handler.
 * Normalises Prisma, Zod, and JWT errors into the standard response format:
 *   { success: false, message, data: null }
 */
// eslint-disable-next-line no-unused-vars
function globalErrorHandler(err, _req, res, _next) {
  // ── Zod validation errors ──────────────────────────────────────────
  if (err instanceof ZodError) {
    const messages = err.errors.map(
      (e) => `${e.path.join(".")}: ${e.message}`
    );
    return res.status(400).json(errorResponse("Validation failed.", messages));
  }

  // ── JWT errors ─────────────────────────────────────────────────────
  if (err instanceof TokenExpiredError) {
    return res.status(401).json(errorResponse("Token expired."));
  }
  if (err instanceof JsonWebTokenError) {
    return res.status(401).json(errorResponse("Invalid token."));
  }

  // ── Prisma errors ──────────────────────────────────────────────────
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002": {
        const fields = err.meta?.target?.join(", ") || "field";
        return res
          .status(409)
          .json(errorResponse(`Unique constraint violation on: ${fields}`));
      }
      case "P2025":
        return res.status(404).json(errorResponse("Record not found."));
      case "P2003":
        return res
          .status(400)
          .json(errorResponse("Related record not found (foreign key constraint)."));
      default:
        return res
          .status(400)
          .json(errorResponse(`Database error: ${err.code}`));
    }
  }

  if (err instanceof Prisma.PrismaClientValidationError) {
    return res.status(400).json(errorResponse("Invalid query parameters."));
  }

  // ── Generic / unexpected errors ────────────────────────────────────
  console.error("[Error]", err);

  const statusCode = err.statusCode || 500;
  const message =
    process.env.NODE_ENV === "production"
      ? "Internal server error."
      : err.message || "Internal server error.";

  return res.status(statusCode).json(errorResponse(message));
}

module.exports = { globalErrorHandler };
