const Redis = require("ioredis");

let redis = null;
let redisAvailable = false;

// Try to connect to Redis, but don't fail if unavailable
try {
  redis = new Redis(process.env.REDIS_URL || "redis://localhost:6379", {
    maxRetriesPerRequest: 3,
    retryStrategy(times) {
      if (times > 5) return null;
      return Math.min(times * 200, 2000);
    },
    lazyConnect: true, // Don't connect immediately
    connectTimeout: 5000,
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
  });

  redis.on("connect", () => {
    redisAvailable = true;
    console.log("[Redis] Connected");
  });

  redis.on("error", (err) => {
    redisAvailable = false;
    console.warn("[Redis] Connection unavailable - using in-memory fallback:", err.message);
  });

  // Attempt connection
  redis.connect().catch(() => {
    console.warn("[Redis] Failed to connect - using in-memory fallback");
  });
} catch (error) {
  console.warn("[Redis] Failed to initialize - using in-memory fallback:", error.message);
  redis = null;
}

// In-memory fallback storage for when Redis is unavailable
const inMemoryStorage = new Map();

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
  if (redisAvailable && redis) {
    await redis.set(key, token, "EX", ttlSeconds);
  } else {
    // In-memory fallback with TTL
    inMemoryStorage.set(key, { value: token, expiresAt: Date.now() + ttlSeconds * 1000 });
  }
}

/** Return the active token for a user (null if none / expired). */
async function getSession(userId) {
  const key = `${SESSION_PREFIX}${userId}`;
  if (redisAvailable && redis) {
    return redis.get(key);
  } else {
    const entry = inMemoryStorage.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.value;
    }
    inMemoryStorage.delete(key);
    return null;
  }
}

/** Explicitly remove a user's session. */
async function destroySession(userId) {
  const key = `${SESSION_PREFIX}${userId}`;
  if (redisAvailable && redis) {
    return redis.del(key);
  } else {
    inMemoryStorage.delete(key);
    return 1;
  }
}

/** Extend session TTL (used for drivers with IN_TRANSIT loads). */
async function extendSession(userId, ttlSeconds) {
  const key = `${SESSION_PREFIX}${userId}`;
  if (redisAvailable && redis) {
    return redis.expire(key, ttlSeconds);
  } else {
    const entry = inMemoryStorage.get(key);
    if (entry) {
      entry.expiresAt = Date.now() + ttlSeconds * 1000;
      return 1;
    }
    return 0;
  }
}

// ── Login-attempt / lockout helpers ──────────────────────────────────

async function getLoginAttempts(identifier) {
  const key = `${ATTEMPTS_PREFIX}${identifier}`;
  if (redisAvailable && redis) {
    const val = await redis.get(key);
    return val ? parseInt(val, 10) : 0;
  } else {
    const entry = inMemoryStorage.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return parseInt(entry.value, 10);
    }
    inMemoryStorage.delete(key);
    return 0;
  }
}

async function incrementLoginAttempts(identifier) {
  const key = `${ATTEMPTS_PREFIX}${identifier}`;
  const lockoutMinutes = parseInt(process.env.LOGIN_LOCKOUT_MINUTES, 10) || 15;
  const ttlMs = lockoutMinutes * 60 * 1000;

  if (redisAvailable && redis) {
    const count = await redis.incr(key);
    await redis.expire(key, lockoutMinutes * 60);
    return count;
  } else {
    const entry = inMemoryStorage.get(key);
    let count = 1;
    if (entry && entry.expiresAt > Date.now()) {
      count = parseInt(entry.value, 10) + 1;
    }
    inMemoryStorage.set(key, { value: count.toString(), expiresAt: Date.now() + ttlMs });
    return count;
  }
}

async function resetLoginAttempts(identifier) {
  const key = `${ATTEMPTS_PREFIX}${identifier}`;
  if (redisAvailable && redis) {
    return redis.del(key);
  } else {
    inMemoryStorage.delete(key);
    return 1;
  }
}

async function lockAccount(identifier) {
  const key = `${LOCKOUT_PREFIX}${identifier}`;
  const lockoutMinutes = parseInt(process.env.LOGIN_LOCKOUT_MINUTES, 10) || 15;
  const ttlMs = lockoutMinutes * 60 * 1000;

  if (redisAvailable && redis) {
    return redis.set(key, "1", "EX", lockoutMinutes * 60);
  } else {
    inMemoryStorage.set(key, { value: "1", expiresAt: Date.now() + ttlMs });
    return "OK";
  }
}

async function isAccountLocked(identifier) {
  const key = `${LOCKOUT_PREFIX}${identifier}`;
  if (redisAvailable && redis) {
    const val = await redis.get(key);
    return val === "1";
  } else {
    const entry = inMemoryStorage.get(key);
    if (entry && entry.expiresAt > Date.now()) {
      return entry.value === "1";
    }
    inMemoryStorage.delete(key);
    return false;
  }
}

/** Destroy sessions for an array of user IDs in parallel. */
async function invalidateMultipleUsers(userIds) {
  if (!userIds.length) return;
  const keys = userIds.map((id) => `${SESSION_PREFIX}${id}`);
  
  if (redisAvailable && redis) {
    return redis.del(...keys);
  } else {
    keys.forEach((key) => inMemoryStorage.delete(key));
    return keys.length;
  }
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
  invalidateMultipleUsers,
};
