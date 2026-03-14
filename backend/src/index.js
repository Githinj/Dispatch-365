require("dotenv").config();

const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

const { connectDatabase, disconnectDatabase } = require("./services/prisma.service");
const { redis } = require("./services/redis.service");
const { authenticate } = require("./middleware/auth.middleware");
const { stripFinancialFields } = require("./middleware/roles.middleware");
const { isolate } = require("./middleware/isolation.middleware");
const { audit } = require("./middleware/audit.middleware");
const { globalErrorHandler } = require("./middleware/error.middleware");

const authRoutes = require("./routes/auth/auth.routes");
const agencyRoutes = require("./routes/agency/agency.routes");

const app = express();
const PORT = process.env.PORT || 4000;

// ── Global middleware ────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan("short"));

// ── Public routes (no auth required) ─────────────────────────────────
app.use("/api/auth", authRoutes);

// ── Health check ─────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ success: true, message: "Dispatch-365 API is running." });
});

// ── Protected middleware stack ────────────────────────────────────────
// All routes registered after this point require authentication.
app.use("/api", authenticate);
app.use("/api", isolate);
app.use("/api", stripFinancialFields);
app.use("/api", audit);

// ── Protected routes (register below this line) ──────────────────────
app.use("/api/agencies", agencyRoutes);

// ── Global error handler (must be last) ──────────────────────────────
app.use(globalErrorHandler);

// ── Start server ─────────────────────────────────────────────────────
async function start() {
  await connectDatabase();
  app.listen(PORT, () => {
    console.log(`[Server] Dispatch-365 API listening on port ${PORT}`);
  });
}

// Graceful shutdown
async function shutdown() {
  console.log("\n[Server] Shutting down…");
  await disconnectDatabase();
  redis.disconnect();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

// Only auto-start when run directly (not when imported by tests)
if (require.main === module) {
  start();
}

module.exports = app;
