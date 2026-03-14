require("dotenv").config();

const path = require("path");
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

// ── Route imports ───────────────────────────────────────────────────
const authRoutes = require("./routes/auth/auth.routes");
const agencyRoutes = require("./routes/agency/agency.routes");
const fleetRoutes = require("./routes/fleet/fleet.routes");
const dispatcherRoutes = require("./routes/dispatcher/dispatcher.routes");
const driverRoutes = require("./routes/driver/driver.routes");
const vehicleRoutes = require("./routes/vehicle/vehicle.routes");
const loadRoutes = require("./routes/load/load.routes");
const invoiceRoutes = require("./routes/invoice/invoice.routes");
const notificationRoutes = require("./routes/notification/notification.routes");
const superAdminRoutes = require("./routes/super-admin/super-admin.routes");

// ── Scheduled jobs ──────────────────────────────────────────────────
const { startAllJobs } = require("./jobs/scheduler");

const app = express();
const PORT = process.env.PORT || 4000;

// ── Global middleware ────────────────────────────────────────────────
app.use(helmet());
app.use(cors());
app.use(express.json());
app.use(morgan("short"));

// ── Static files (POD + PDF uploads — dev only; use S3/R2 in production) ──
app.use("/uploads", express.static(path.join(__dirname, "../uploads")));

// ── Public routes (no auth required) ─────────────────────────────────
app.use("/api/auth", authRoutes);

// ── Health check ─────────────────────────────────────────────────────
app.get("/api/health", (_req, res) => {
  res.json({ success: true, message: "Dispatch-365 API is running." });
});

// ── Protected middleware stack ────────────────────────────────────────
// All routes registered after this point require authentication.
// Stack order: authenticate → isolate → stripFinancialFields → audit
app.use("/api", authenticate);
app.use("/api", isolate);
app.use("/api", stripFinancialFields);
app.use("/api", audit);

// ── Protected routes ─────────────────────────────────────────────────
app.use("/api/agencies", agencyRoutes);
app.use("/api/fleets", fleetRoutes);
app.use("/api/dispatchers", dispatcherRoutes);
app.use("/api/drivers", driverRoutes);
app.use("/api/vehicles", vehicleRoutes);
app.use("/api/loads", loadRoutes);
app.use("/api/invoices", invoiceRoutes);
app.use("/api/notifications", notificationRoutes);
app.use("/api/super-admin", superAdminRoutes);

// ── Global error handler (must be last) ──────────────────────────────
app.use(globalErrorHandler);

// ── Start server ─────────────────────────────────────────────────────
async function start() {
  await connectDatabase();
  app.listen(PORT, () => {
    console.log(`[Server] Dispatch-365 API listening on port ${PORT}`);
    startAllJobs();
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
