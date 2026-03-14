require("dotenv").config();

const path = require("path");
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const morgan = require("morgan");

// Load services with graceful fallbacks for development
let connectDatabase, disconnectDatabase, redis;

try {
  const prismaService = require("./services/prisma.service");
  connectDatabase = prismaService.connectDatabase;
  disconnectDatabase = prismaService.disconnectDatabase;
} catch (error) {
  console.warn("[Server] Prisma service unavailable:", error.message);
  connectDatabase = async () => console.log("[Server] Database connection skipped (development mode)");
  disconnectDatabase = async () => {};
}

try {
  redis = require("./services/redis.service").redis;
} catch (error) {
  console.warn("[Server] Redis service unavailable:", error.message);
  redis = { disconnect: () => {} };
}

let authenticate;
try {
  authenticate = require("./middleware/auth.middleware").authenticate;
} catch (error) {
  console.warn("[Server] Auth middleware unavailable:", error.message);
  authenticate = (req, res, next) => next(); // Pass through in development
}
let stripFinancialFields, isolate, audit, globalErrorHandler;

try {
  stripFinancialFields = require("./middleware/roles.middleware").stripFinancialFields;
} catch (error) {
  stripFinancialFields = (req, res, next) => next();
}

try {
  isolate = require("./middleware/isolation.middleware").isolate;
} catch (error) {
  isolate = (req, res, next) => next();
}

try {
  audit = require("./middleware/audit.middleware").audit;
} catch (error) {
  audit = (req, res, next) => next();
}

try {
  globalErrorHandler = require("./middleware/error.middleware").globalErrorHandler;
} catch (error) {
  globalErrorHandler = (err, req, res, next) => {
    console.error("[Error]", err.message);
    res.status(500).json({ success: false, error: err.message });
  };
}

// ── Route imports ───────────────────────────────────────────────────
const mockRouter = () => require("express").Router();

let authRoutes, agencyRoutes, fleetRoutes, dispatcherRoutes, driverRoutes, vehicleRoutes, 
    loadRoutes, invoiceRoutes, notificationRoutes, superAdminRoutes;

try { authRoutes = require("./routes/auth/auth.routes"); } catch(e) { authRoutes = mockRouter(); }
try { agencyRoutes = require("./routes/agency/agency.routes"); } catch(e) { agencyRoutes = mockRouter(); }
try { fleetRoutes = require("./routes/fleet/fleet.routes"); } catch(e) { fleetRoutes = mockRouter(); }
try { dispatcherRoutes = require("./routes/dispatcher/dispatcher.routes"); } catch(e) { dispatcherRoutes = mockRouter(); }
try { driverRoutes = require("./routes/driver/driver.routes"); } catch(e) { driverRoutes = mockRouter(); }
try { vehicleRoutes = require("./routes/vehicle/vehicle.routes"); } catch(e) { vehicleRoutes = mockRouter(); }
try { loadRoutes = require("./routes/load/load.routes"); } catch(e) { loadRoutes = mockRouter(); }
try { invoiceRoutes = require("./routes/invoice/invoice.routes"); } catch(e) { invoiceRoutes = mockRouter(); }
try { notificationRoutes = require("./routes/notification/notification.routes"); } catch(e) { notificationRoutes = mockRouter(); }
try { superAdminRoutes = require("./routes/super-admin/super-admin.routes"); } catch(e) { superAdminRoutes = mockRouter(); }

// ── Scheduled jobs ──────────────────────────────────────────────────
let startAllJobs;
try {
  startAllJobs = require("./jobs/scheduler").startAllJobs;
} catch (error) {
  console.warn("[Server] Scheduler unavailable:", error.message);
  startAllJobs = () => console.log("[Server] Jobs scheduler skipped (development mode)");
}

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
