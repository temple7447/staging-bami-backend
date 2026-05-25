const express = require('express');
const router = express.Router();
const { protect } = require('../middleware/auth');
const {
    getNotifications,
    getNotificationCount,
    markAsRead,
    markAllAsRead,
    deleteNotification
} = require('../controllers/notificationController');

// Get user's notifications
router.get('/', protect, getNotifications);

// Unread count only (must be before /:id routes)
router.get('/count', protect, getNotificationCount);

// Mark all as read (must be before /:id routes)
router.put('/read-all', protect, markAllAsRead);

// Mark single notification as read
router.put('/:id/read', protect, markAsRead);

// Delete notification
router.delete('/:id', protect, deleteNotification);

module.exports = router;
