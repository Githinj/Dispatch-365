// ── Notification Service ────────────────────────────────────────────
// In-app notifications stored in the Notification table.
// Combined `notify()` dispatches both in-app + email in parallel.

const { prisma } = require("./prisma.service");
const emailService = require("./email.service");

// ── Create single notification ─────────────────────────────────────

/**
 * @param {Object} opts
 * @param {string} opts.userId
 * @param {string} opts.type    — e.g. "LOAD_ASSIGNED", "INVOICE_OVERDUE"
 * @param {string} opts.title
 * @param {string} opts.message
 * @param {Object} [opts.data]  — JSON-serialisable deep-link payload
 * @returns {Promise<Object|null>}
 */
async function createNotification({ userId, type, title, message, data }) {
  try {
    return await prisma.notification.create({
      data: {
        userId,
        type,
        title,
        message,
        data: data ? JSON.stringify(data) : null,
      },
    });
  } catch (err) {
    console.error("[Notification] Failed to create:", err.message);
    return null;
  }
}

// ── Batch create for multiple users ────────────────────────────────

/**
 * @param {string[]} userIds
 * @param {string}   type
 * @param {string}   title
 * @param {string}   message
 * @param {Object}   [data]
 */
async function createNotificationsForMultiple(userIds, type, title, message, data) {
  if (!userIds?.length) return;
  try {
    const serialised = data ? JSON.stringify(data) : null;
    await prisma.notification.createMany({
      data: userIds.map((userId) => ({
        userId,
        type,
        title,
        message,
        data: serialised,
      })),
    });
  } catch (err) {
    console.error("[Notification] Batch create failed:", err.message);
  }
}

// ── Query helpers (used by controller) ─────────────────────────────

async function getNotifications(userId, { unreadOnly, page, perPage, skip }) {
  const where = { userId };
  if (unreadOnly) where.isRead = false;

  const [data, total] = await Promise.all([
    prisma.notification.findMany({
      where,
      skip,
      take: perPage,
      orderBy: { createdAt: "desc" },
    }),
    prisma.notification.count({ where }),
  ]);

  // Parse data JSON for convenience
  const parsed = data.map((n) => ({
    ...n,
    data: n.data ? JSON.parse(n.data) : null,
  }));

  return { data: parsed, total, page, perPage };
}

async function getUnreadCount(userId) {
  return prisma.notification.count({ where: { userId, isRead: false } });
}

async function markAsRead(id, userId) {
  return prisma.notification.updateMany({
    where: { id, userId },
    data: { isRead: true, readAt: new Date() },
  });
}

async function markAllAsRead(userId) {
  return prisma.notification.updateMany({
    where: { userId, isRead: false },
    data: { isRead: true, readAt: new Date() },
  });
}

// ═══════════════════════════════════════════════════════════════════
//  COMBINED NOTIFY — in-app + email in parallel, never throws
// ═══════════════════════════════════════════════════════════════════

/**
 * Fire-and-forget combined notifier.
 *
 * @param {Object}   opts
 * @param {string}   opts.userId       — recipient user id
 * @param {string}   opts.email        — recipient email address
 * @param {string}   opts.type         — notification type enum string
 * @param {string}   opts.title        — in-app notification title
 * @param {string}   opts.message      — in-app notification message
 * @param {Object}   [opts.data]       — deep-link JSON payload
 * @param {Object}   opts.emailPayload — { subject, html, from, replyTo } from email builder
 */
async function notify({ userId, email, type, title, message, data, emailPayload }) {
  const inApp = createNotification({ userId, type, title, message, data });

  let emailPromise = Promise.resolve();
  if (email && emailPayload) {
    emailPromise = emailService.sendEmail({
      to: email,
      subject: emailPayload.subject,
      html: emailPayload.html,
      from: emailPayload.from,
      replyTo: emailPayload.replyTo,
    });
  }

  // Both run in parallel; neither can break the caller
  await Promise.allSettled([inApp, emailPromise]);
}

/**
 * Notify multiple users with the same in-app notification + individual emails.
 *
 * @param {Array<{userId:string, email:string}>} recipients
 * @param {string}  type
 * @param {string}  title
 * @param {string}  message
 * @param {Object}  [data]
 * @param {Object}  emailPayload — same email content sent to every recipient
 */
async function notifyMultiple(recipients, type, title, message, data, emailPayload) {
  const userIds = recipients.map((r) => r.userId);
  const batch = createNotificationsForMultiple(userIds, type, title, message, data);

  let emailPromises = [];
  if (emailPayload) {
    emailPromises = recipients
      .filter((r) => r.email)
      .map((r) =>
        emailService.sendEmail({
          to: r.email,
          subject: emailPayload.subject,
          html: emailPayload.html,
          from: emailPayload.from,
          replyTo: emailPayload.replyTo,
        })
      );
  }

  await Promise.allSettled([batch, ...emailPromises]);
}

module.exports = {
  // Core CRUD
  createNotification,
  createNotificationsForMultiple,
  getNotifications,
  getUnreadCount,
  markAsRead,
  markAllAsRead,
  // Combined notifiers
  notify,
  notifyMultiple,
};
