const Notification = require('../models/Notification');

// @desc    Get user's notifications
// @route   GET /api/notifications
// @access  Private
exports.getNotifications = async (req, res) => {
    try {
        const { isRead, limit = 50 } = req.query;

        const filter = {
            user: req.user.id,
            isActive: true
        };

        if (isRead !== undefined) {
            filter.isRead = isRead === 'true';
        }

        const notifications = await Notification.find(filter)
            .sort({ createdAt: -1 })
            .limit(parseInt(limit));

        const unreadCount = await Notification.countDocuments({
            user: req.user.id,
            isRead: false,
            isActive: true
        });

        res.status(200).json({
            success: true,
            count: notifications.length,
            unreadCount,
            data: notifications
        });
    } catch (err) {
        console.error('Get notifications error:', err);
        res.status(500).json({ success: false, message: 'Server error occurred while fetching notifications' });
    }
};

// @desc    Mark notification as read
// @route   PUT /api/notifications/:id/read
// @access  Private
exports.markAsRead = async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            {
                _id: req.params.id,
                user: req.user.id,
                isActive: true
            },
            {
                isRead: true,
                readAt: Date.now()
            },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.status(200).json({
            success: true,
            data: notification
        });
    } catch (err) {
        console.error('Mark notification as read error:', err);
        res.status(500).json({ success: false, message: 'Server error occurred while marking notification as read' });
    }
};

// @desc    Mark all notifications as read
// @route   PUT /api/notifications/read-all
// @access  Private
exports.markAllAsRead = async (req, res) => {
    try {
        const result = await Notification.updateMany(
            {
                user: req.user.id,
                isRead: false,
                isActive: true
            },
            {
                isRead: true,
                readAt: Date.now()
            }
        );

        res.status(200).json({
            success: true,
            message: `${result.modifiedCount} notifications marked as read`
        });
    } catch (err) {
        console.error('Mark all as read error:', err);
        res.status(500).json({ success: false, message: 'Server error occurred while marking all notifications as read' });
    }
};

// @desc    Get unread notification count only (lightweight, for badge)
// @route   GET /api/notifications/count
// @access  Private
exports.getNotificationCount = async (req, res) => {
    try {
        const unreadCount = await Notification.countDocuments({
            user: req.user.id,
            isRead: false,
            isActive: true,
        });
        res.status(200).json({ success: true, unreadCount });
    } catch (err) {
        console.error('Get notification count error:', err);
        res.status(500).json({ success: false, message: 'Server error fetching notification count' });
    }
};

// @desc    Delete notification
// @route   DELETE /api/notifications/:id
// @access  Private
exports.deleteNotification = async (req, res) => {
    try {
        const notification = await Notification.findOneAndUpdate(
            {
                _id: req.params.id,
                user: req.user.id
            },
            {
                isActive: false
            },
            { new: true }
        );

        if (!notification) {
            return res.status(404).json({ success: false, message: 'Notification not found' });
        }

        res.status(200).json({
            success: true,
            message: 'Notification deleted successfully'
        });
    } catch (err) {
        console.error('Delete notification error:', err);
        res.status(500).json({ success: false, message: 'Server error occurred while deleting notification' });
    }
};
