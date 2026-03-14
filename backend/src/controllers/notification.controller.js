const { success, error, paginate, parsePagination } = require("../utils/response.utils");
const notificationService = require("../services/notification.service");

// GET /api/notifications
async function list(req, res, next) {
  try {
    const { page, perPage, skip } = parsePagination(req.query);
    const unreadOnly = req.query.unreadOnly === "true";

    const result = await notificationService.getNotifications(req.user.userId, {
      unreadOnly,
      page,
      perPage,
      skip,
    });

    return res.json(paginate(result));
  } catch (err) {
    next(err);
  }
}

// GET /api/notifications/unread-count
async function unreadCount(req, res, next) {
  try {
    const count = await notificationService.getUnreadCount(req.user.userId);
    return res.json(success("Unread count retrieved.", { count }));
  } catch (err) {
    next(err);
  }
}

// PATCH /api/notifications/:id/read
async function markRead(req, res, next) {
  try {
    const { id } = req.params;
    const result = await notificationService.markAsRead(id, req.user.userId);

    if (result.count === 0) {
      return res.status(404).json(error("Notification not found."));
    }

    return res.json(success("Notification marked as read."));
  } catch (err) {
    next(err);
  }
}

// PATCH /api/notifications/read-all
async function markAllRead(req, res, next) {
  try {
    const result = await notificationService.markAllAsRead(req.user.userId);
    return res.json(success(`Marked ${result.count} notification(s) as read.`));
  } catch (err) {
    next(err);
  }
}

module.exports = { list, unreadCount, markRead, markAllRead };
