// ── Job Scheduler ───────────────────────────────────────────────────
// Lightweight scheduler using setInterval. No external deps needed.
// Each job runs independently — failure of one never stops others.

const invoiceOverdue = require("./invoice-overdue.job");
const documentExpiry = require("./document-expiry.job");
const transferReminder = require("./transfer-reminder.job");
const sessionCleanup = require("./session-cleanup.job");
const subscriptionExpiry = require("./subscription-expiry.job");
const performanceSummary = require("./performance-summary.job");

const HOUR = 3600000;
const DAY = 24 * HOUR;

/**
 * Run a single job, wrapped in try/catch with timing.
 */
async function execute(name, fn) {
  const start = Date.now();
  const ts = new Date().toISOString().replace("T", " ").slice(0, 19);
  console.log(`[JOB] ${name} started at ${ts}`);
  try {
    const result = await fn();
    const elapsed = Date.now() - start;
    console.log(`[JOB] ${name} completed in ${elapsed}ms`, result ? JSON.stringify(result) : "");
  } catch (err) {
    const elapsed = Date.now() - start;
    console.error(`[JOB] ${name} failed after ${elapsed}ms:`, err.message);
  }
}

/**
 * Schedule a job to run on a fixed interval.
 * Runs once immediately on startup, then repeats.
 */
function schedule(name, fn, intervalMs) {
  // Run once at startup (delayed slightly to let DB connections settle)
  setTimeout(() => execute(name, fn), 5000);
  // Then repeat
  setInterval(() => execute(name, fn), intervalMs);
}

/**
 * Schedule a job that only runs on a specific day of the month.
 * Checks daily; the job's run() function itself gates on date.
 */
function scheduleMonthly(name, fn) {
  // Check daily; the job itself checks if it's the 1st
  setTimeout(() => execute(name, fn), 10000);
  setInterval(() => execute(name, fn), DAY);
}

/**
 * Start all scheduled jobs. Called once from index.js after server starts.
 */
function startAllJobs() {
  console.log("[Scheduler] Starting all scheduled jobs...");

  // JOB 1: Invoice overdue — daily
  schedule("invoice-overdue", invoiceOverdue.run, DAY);

  // JOB 2: Document expiry — daily
  schedule("document-expiry", documentExpiry.run, DAY);

  // JOB 3: Transfer reminder — daily
  schedule("transfer-reminder", transferReminder.run, DAY);

  // JOB 4: Session cleanup — daily
  schedule("session-cleanup", sessionCleanup.run, DAY);

  // JOB 5: Subscription expiry — daily
  schedule("subscription-expiry", subscriptionExpiry.run, DAY);

  // JOB 6: Monthly performance summary — checked daily, runs on 1st
  scheduleMonthly("performance-summary", performanceSummary.run);

  console.log("[Scheduler] All 6 jobs registered.");
}

module.exports = { startAllJobs };
