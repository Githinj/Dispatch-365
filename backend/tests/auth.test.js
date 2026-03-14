require("dotenv").config();

const request = require("supertest");
const bcrypt = require("bcryptjs");
const app = require("../src/index");
const { prisma } = require("../src/services/prisma.service");
const { redis } = require("../src/services/redis.service");

const TEST_USER = {
  email: "testdriver@dispatch365.com",
  password: "SecurePass123!",
  firstName: "Test",
  lastName: "User",
  role: "Dispatcher",
};

let server;

beforeAll(async () => {
  // Wait briefly for DB/Redis connections
  await new Promise((r) => setTimeout(r, 1000));

  // Clean up any previous test data
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { email: TEST_USER.email } });

  // Seed test user
  const hashed = await bcrypt.hash(TEST_USER.password, 10);
  await prisma.user.create({
    data: {
      email: TEST_USER.email,
      password: hashed,
      firstName: TEST_USER.firstName,
      lastName: TEST_USER.lastName,
      role: TEST_USER.role,
      isActive: true,
    },
  });
});

afterAll(async () => {
  // Clean up
  await prisma.auditLog.deleteMany({});
  await prisma.user.deleteMany({ where: { email: TEST_USER.email } });
  await prisma.$disconnect();
  redis.disconnect();
});

// ── Test 1: Login with valid credentials returns JWT ─────────────────

describe("POST /api/auth/login", () => {
  test("returns JWT token with valid credentials", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Login successful.");
    expect(res.body.data).toHaveProperty("token");
    expect(typeof res.body.data.token).toBe("string");
    expect(res.body.data.user.email).toBe(TEST_USER.email);
  });
});

// ── Test 2: Second login invalidates first session ───────────────────

describe("Single session enforcement", () => {
  test("new login invalidates previous session", async () => {
    // First login
    const login1 = await request(app)
      .post("/api/auth/login")
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    const token1 = login1.body.data.token;

    // Wait 1s so JWT iat differs → produces a different token
    await new Promise((r) => setTimeout(r, 1100));

    // Second login (simulates different device)
    const login2 = await request(app)
      .post("/api/auth/login")
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    const token2 = login2.body.data.token;
    expect(token2).not.toBe(token1);

    // First token should now be invalid
    const meWithOldToken = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token1}`);

    expect(meWithOldToken.status).toBe(401);
    expect(meWithOldToken.body.success).toBe(false);

    // Second token should work
    const meWithNewToken = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token2}`);

    expect(meWithNewToken.status).toBe(200);
    expect(meWithNewToken.body.success).toBe(true);
  });
});

// ── Test 3: GET /auth/me returns user profile ────────────────────────

describe("GET /api/auth/me", () => {
  test("returns authenticated user profile", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    const token = loginRes.body.data.token;

    const res = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toBe("Authenticated user.");
    expect(res.body.data).toHaveProperty("userId");
    expect(res.body.data).toHaveProperty("role", TEST_USER.role);
  });

  test("rejects request without token", async () => {
    const res = await request(app).get("/api/auth/me");
    expect(res.status).toBe(401);
    expect(res.body.success).toBe(false);
  });
});

// ── Test 4: Logout invalidates session in Redis ──────────────────────

describe("POST /api/auth/logout", () => {
  test("invalidates session after logout", async () => {
    const loginRes = await request(app)
      .post("/api/auth/login")
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    const token = loginRes.body.data.token;

    // Logout
    const logoutRes = await request(app)
      .post("/api/auth/logout")
      .set("Authorization", `Bearer ${token}`);

    expect(logoutRes.status).toBe(200);
    expect(logoutRes.body.success).toBe(true);

    // Token should no longer work
    const meRes = await request(app)
      .get("/api/auth/me")
      .set("Authorization", `Bearer ${token}`);

    expect(meRes.status).toBe(401);
    expect(meRes.body.success).toBe(false);
  });
});

// ── Test 5: Account lockout after 5 failed attempts ──────────────────

describe("Account lockout", () => {
  test("locks account after 5 failed login attempts", async () => {
    // Reset any existing lockout state for test user
    await redis.del(`lockout:${TEST_USER.email}`);
    await redis.del(`login_attempts:${TEST_USER.email}`);

    // Attempt 5 failed logins
    for (let i = 1; i <= 5; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .send({ email: TEST_USER.email, password: "WrongPassword!" });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
    }

    // 6th attempt should report account locked
    const lockedRes = await request(app)
      .post("/api/auth/login")
      .send({ email: TEST_USER.email, password: TEST_USER.password });

    expect(lockedRes.status).toBe(401);
    expect(lockedRes.body.success).toBe(false);
    expect(lockedRes.body.message).toMatch(/locked/i);

    // Clean up lockout for subsequent tests
    await redis.del(`lockout:${TEST_USER.email}`);
    await redis.del(`login_attempts:${TEST_USER.email}`);
  });
});
