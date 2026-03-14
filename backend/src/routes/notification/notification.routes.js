const { Router } = require("express");
const ctrl = require("../../controllers/notification.controller");

const router = Router();

// All notification endpoints are behind authenticate (applied globally in index.js).
// No role restriction — every authenticated user reads their own notifications.
// Isolation is enforced by filtering on req.user.userId inside the service.

// Named sub-resources BEFORE /:id to avoid route conflicts
router.get("/unread-count", ctrl.unreadCount);
router.patch("/read-all", ctrl.markAllRead);

// Collection
router.get("/", ctrl.list);

// Single resource
router.patch("/:id/read", ctrl.markRead);

module.exports = router;
