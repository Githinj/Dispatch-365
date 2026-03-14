const { Router } = require("express");
const { z } = require("zod");
const { login, logout } = require("../../services/auth.service");
const { authenticate } = require("../../middleware/auth.middleware");
const { success, error } = require("../../utils/response.utils");

const router = Router();

// ── Validation schemas ───────────────────────────────────────────────

const loginSchema = z.object({
  email: z.string().email("Valid email is required."),
  password: z.string().min(1, "Password is required."),
});

// ── POST /auth/login ─────────────────────────────────────────────────

router.post("/login", async (req, res, next) => {
  try {
    const { email, password } = loginSchema.parse(req.body);
    const result = await login(email, password);

    if (!result.success) {
      return res.status(401).json(error(result.message));
    }

    return res.json(success(result.message, result.data));
  } catch (err) {
    next(err);
  }
});

// ── POST /auth/logout ────────────────────────────────────────────────

router.post("/logout", authenticate, async (req, res, next) => {
  try {
    const result = await logout(req.user.userId);
    return res.json(success(result.message));
  } catch (err) {
    next(err);
  }
});

// ── GET /auth/me ─────────────────────────────────────────────────────

router.get("/me", authenticate, (req, res) => {
  return res.json(success("Authenticated user.", req.user));
});

module.exports = router;
