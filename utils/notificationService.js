const Notification = require('../models/Notification');
const { logError } = require('./logger');

/**
 * Create a new notification for a user
 * @param {Object} options - Notification options
 * @param {string} options.user - User ID to receive notification
 * @param {string} options.title - Notification title
 * @param {string} options.message - Notification message body
 * @param {string} options.type - Type of notification (payment, billing, system, etc.)
 * @param {Object} [options.metadata] - Optional metadata to store
 * @returns {Promise<Object|null>} Created notification or null on error
 */
const createNotification = async ({ user, title, message, type = 'system', metadata = {} }) => {
  try {
    if (!user || !title || !message) {
      console.warn('Notification creation failed: Missing required fields');
      return null;
    }

    const notification = await Notification.create({
      user,
      title,
      message,
      type,
      metadata,
      isActive: true
    });

    return notification;
  } catch (error) {
    // Log error but don't crash the calling process (notifications are often non-critical)
    logError('Create Notification Error', error.message);
    return null;
  }
};

module.exports = {
  createNotification
};
