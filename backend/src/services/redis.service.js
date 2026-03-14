const Redis = require("ioredis");

const redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    if (times > 5) return null;
    return Math.min(times * 200, 2000);
  },
});

redis.on("connect", () => console.log("[Redis] Connected"));
redis.on("error", (err) => console.error("[Redis] Error:", err.message));

// ── Session helpers ──────────────────────────────────────────────────

const SESSION_PREFIX = "session:";
const LOCKOUT_PREFIX = "lockout:";
const ATTEMPTS_PREFIX = "login_attempts:";

/**
 * Store a session token for a user.
 * Single-session rule: any previous session key for the user is deleted first.
 */
async function createSession(userId, token, ttlSeconds) {
  const key = `${SESSION_PREFIX}${userId}`;
  await redis.set(key, token, "EX", ttlSeconds);
}

/** Return the active token for a user (null if none / expired). */
async function getSession(userId) {
  return redis.get(`${SESSION_PREFIX}${userId}`);
}

/** Explicitly remove a user's session. */
async function destroySession(userId) {
  return redis.del(`${SESSION_PREFIX}${userId}`);
}

/** Extend session TTL (used for drivers with IN_TRANSIT loads). */
async function extendSession(userId, ttlSeconds) {
  return redis.expire(`${SESSION_PREFIX}${userId}`, ttlSeconds);
}

// ── Login-attempt / lockout helpers ──────────────────────────────────

async function getLoginAttempts(identifier) {
  const val = await redis.get(`${ATTEMPTS_PREFIX}${identifier}`);
  return val ? parseInt(val, 10) : 0;
}

async function incrementLoginAttempts(identifier) {
  const key = `${ATTEMPTS_PREFIX}${identifier}`;
  const count = await redis.incr(key);
  // Expire the counter after lockout window so it auto-resets
  const lockoutMinutes = parseInt(process.env.LOGIN_LOCKOUT_MINUTES, 10) || 15;
  await redis.expire(key, lockoutMinutes * 60);
  return count;
}

async function resetLoginAttempts(identifier) {
  return redis.del(`${ATTEMPTS_PREFIX}${identifier}`);
}

async function lockAccount(identifier) {
  const lockoutMinutes = parseInt(process.env.LOGIN_LOCKOUT_MINUTES, 10) || 15;
  return redis.set(`${LOCKOUT_PREFIX}${identifier}`, "1", "EX", lockoutMinutes * 60);
}

async function isAccountLocked(identifier) {
  const val = await redis.get(`${LOCKOUT_PREFIX}${identifier}`);
  return val === "1";
}

module.exports = {
  redis,
  createSession,
  getSession,
  destroySession,
  extendSession,
  getLoginAttempts,
  incrementLoginAttempts,
  resetLoginAttempts,
  lockAccount,
  isAccountLocked,
};
