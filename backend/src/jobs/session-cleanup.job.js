// ── JOB 4: Session Cleanup ──────────────────────────────────────────
// Runs daily. Cleans up stale audit/session records.
// Note: Redis handles real session expiry via TTL automatically.
// This job cleans up the database side to keep tables lean.

const { prisma } = require("../services/prisma.service");

async function run() {
  const now = new Date();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 86400000);

  // Delete audit log entries older than 90 days?
  // NO — audit logs are IMMUTABLE per CLAUDE.md ("no update or delete endpoints ever").
  // We only clean up notification records to keep the table lean.

  // Clean up read notifications older than 90 days
  const { count: deletedNotifications } = await prisma.notification.deleteMany({
    where: {
      isRead: true,
      readAt: { lt: ninetyDaysAgo },
    },
  });

  console.log(`[JOB] session-cleanup: deleted ${deletedNotifications} old read notification(s)`);

  return { deletedNotifications };
}

module.exports = { run };
