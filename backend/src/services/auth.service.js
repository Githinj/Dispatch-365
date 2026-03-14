const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { prisma } = require("./prisma.service");
const {
  createSession,
  destroySession,
  getLoginAttempts,
  incrementLoginAttempts,
  resetLoginAttempts,
  lockAccount,
  isAccountLocked,
} = require("./redis.service");

const MAX_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS, 10) || 5;

// ── Token helpers ────────────────────────────────────────────────────

function signToken(user) {
  const payload = {
    userId: user.id,
    role: user.role,
    ...(user.agencyId && { agencyId: user.agencyId }),
    ...(user.fleetId && { fleetId: user.fleetId }),
  };
  return jwt.sign(payload, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRES_IN || "8h",
  });
}

function verifyToken(token) {
  return jwt.verify(token, process.env.JWT_SECRET);
}

// ── Login ────────────────────────────────────────────────────────────

async function login(email, password) {
  // Check lockout
  if (await isAccountLocked(email)) {
    const lockoutMinutes = parseInt(process.env.LOGIN_LOCKOUT_MINUTES, 10) || 15;
    return {
      success: false,
      message: `Account locked. Try again in ${lockoutMinutes} minutes.`,
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });

  if (!user || !(await bcrypt.compare(password, user.password))) {
    const attempts = await incrementLoginAttempts(email);
    if (attempts >= MAX_ATTEMPTS) {
      await lockAccount(email);
      return {
        success: false,
        message: `Account locked after ${MAX_ATTEMPTS} failed attempts.`,
      };
    }
    return {
      success: false,
      message: `Invalid credentials. ${MAX_ATTEMPTS - attempts} attempt(s) remaining.`,
    };
  }

  if (!user.isActive) {
    return { success: false, message: "Account is deactivated." };
  }

  // Successful login → reset attempts, invalidate old session, create new one
  await resetLoginAttempts(email);

  const token = signToken(user);

  // Parse JWT_EXPIRES_IN to seconds for Redis TTL
  const ttl = parseExpiry(process.env.JWT_EXPIRES_IN || "8h");
  await createSession(user.id, token, ttl);

  return {
    success: true,
    message: "Login successful.",
    data: {
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        firstName: user.firstName,
        lastName: user.lastName,
      },
    },
  };
}

// ── Logout ───────────────────────────────────────────────────────────

async function logout(userId) {
  await destroySession(userId);
  return { success: true, message: "Logged out." };
}

// ── Helpers ──────────────────────────────────────────────────────────

/** Convert shorthand like "8h", "30m", "7d" to seconds. */
function parseExpiry(value) {
  const match = value.match(/^(\d+)([smhd])$/);
  if (!match) return 28800; // default 8 hours
  const num = parseInt(match[1], 10);
  const unit = match[2];
  const multipliers = { s: 1, m: 60, h: 3600, d: 86400 };
  return num * (multipliers[unit] || 3600);
}

module.exports = { login, logout, signToken, verifyToken, parseExpiry };
