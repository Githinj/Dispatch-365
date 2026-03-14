const { verifyToken } = require("../services/auth.service");
const { getSession, extendSession } = require("../services/redis.service");
const { prisma } = require("../services/prisma.service");
const { error } = require("../utils/response.utils");

/**
 * Authenticate requests via JWT + Redis session check.
 * Ensures single-session-per-user: the token must match the active session in Redis.
 * For drivers with IN_TRANSIT loads the session TTL is automatically extended.
 */
async function authenticate(req, res, next) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith("Bearer ")) {
      return res.status(401).json(error("Authentication required."));
    }

    const token = header.split(" ")[1];
    const decoded = verifyToken(token);

    // Confirm this token is the active session in Redis
    const activeToken = await getSession(decoded.userId);
    if (!activeToken || activeToken !== token) {
      return res.status(401).json(error("Session expired or replaced by a new login."));
    }

    // Extend session for drivers with active IN_TRANSIT loads
    if (decoded.role === "Driver") {
      const inTransitLoad = await prisma.load.findFirst({
        where: { driverId: decoded.userId, status: "IN_TRANSIT" },
        select: { id: true },
      });

      if (inTransitLoad) {
        const graceHours = parseInt(process.env.DRIVER_SESSION_GRACE_HOURS, 10) || 24;
        await extendSession(decoded.userId, graceHours * 3600);
      }
    }

    req.user = decoded;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json(error("Token expired."));
    }
    if (err.name === "JsonWebTokenError") {
      return res.status(401).json(error("Invalid token."));
    }
    next(err);
  }
}

module.exports = { authenticate };
