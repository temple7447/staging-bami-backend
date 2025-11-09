const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const ReminderLog = require('../models/ReminderLog');
const User = require('../models/User');
const { sendRentReminder, sendAdminRentReminder } = require('./emailService');

/**
 * Check for upcoming due dates and send reminders
 * Sends reminders at 7 days, 3 days, and 1 day before due date
 */
const checkAndSendReminders = async () => {
  try {
    console.log('[Reminder Service] Starting reminder check at', new Date().toISOString());

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Define reminder thresholds
    const reminderThresholds = [
      { days: 7, type: '7-day' },
      { days: 3, type: '3-day' },
      { days: 1, type: '1-day' }
    ];

    for (const threshold of reminderThresholds) {
      await processReminderThreshold(today, threshold.days, threshold.type);
    }

    console.log('[Reminder Service] Reminder check completed successfully');
  } catch (error) {
    console.error('[Reminder Service] Error during reminder check:', error.message);
  }
};

/**
 * Process reminders for a specific day threshold
 * @param {Date} today - Today's date
 * @param {Number} daysAhead - Number of days to look ahead
 * @param {String} reminderType - Type of reminder (7-day, 3-day, 1-day)
 */
const processReminderThreshold = async (today, daysAhead, reminderType) => {
  try {
    // Calculate target date
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + daysAhead);
    
    const targetDateStart = new Date(targetDate);
    targetDateStart.setHours(0, 0, 0, 0);
    
    const targetDateEnd = new Date(targetDate);
    targetDateEnd.setHours(23, 59, 59, 999);

    console.log(`[Reminder Service] Processing ${reminderType} reminders for date range:`, {
      start: targetDateStart.toISOString(),
      end: targetDateEnd.toISOString()
    });

    // Find all tenants with due dates matching the threshold
    const tenants = await Tenant.find({
      isActive: true,
      status: { $in: ['occupied', 'pending'] },
      nextDueDate: {
        $gte: targetDateStart,
        $lte: targetDateEnd
      },
      tenantEmail: { $exists: true, $ne: '' }
    }).populate('estate');

    console.log(`[Reminder Service] Found ${tenants.length} tenants for ${reminderType} reminder`);

    for (const tenant of tenants) {
      await sendTenantReminder(tenant, reminderType, daysAhead);
    }
  } catch (error) {
    console.error(`[Reminder Service] Error processing ${reminderType} reminders:`, error.message);
  }
};

/**
 * Send reminder to tenant and admin
 * @param {Object} tenant - Tenant document
 * @param {String} reminderType - Type of reminder
 * @param {Number} daysAhead - Days until due date
 */
const sendTenantReminder = async (tenant, reminderType, daysAhead) => {
  try {
    const estate = tenant.estate;

    // Check if reminder already sent for this tenant and due date
    const existingReminder = await ReminderLog.findOne({
      tenant: tenant._id,
      reminderType,
      dueDate: {
        $gte: new Date(tenant.nextDueDate).setHours(0, 0, 0, 0),
        $lte: new Date(tenant.nextDueDate).setHours(23, 59, 59, 999)
      },
      isActive: true
    });

    if (existingReminder) {
      console.log(`[Reminder Service] Reminder already sent for tenant ${tenant._id} - skipping`);
      return;
    }

    // Get admin users for the estate (super_admin and admin)
    const adminUsers = await User.find({
      isActive: true,
      role: { $in: ['super_admin', 'admin'] }
    }).select('email name');

    if (adminUsers.length === 0) {
      console.warn(`[Reminder Service] No admin users found to notify for estate ${estate._id}`);
    }

    let tenantEmailStatus = 'failed';
    let adminEmailStatus = 'failed';
    let errorMessage = '';

    // Send email to tenant
    try {
      await sendRentReminder(tenant, estate, daysAhead);
      tenantEmailStatus = 'sent';
      console.log(`[Reminder Service] Tenant email sent for ${tenant._id}`);
    } catch (tenantError) {
      console.error(`[Reminder Service] Failed to send tenant email:`, tenantError.message);
      errorMessage += `Tenant email failed: ${tenantError.message}. `;
    }

    // Send emails to all admin users
    const adminEmails = adminUsers.map(user => user.email);
    for (const adminEmail of adminEmails) {
      try {
        await sendAdminRentReminder(adminEmail, tenant, estate, daysAhead);
        adminEmailStatus = 'sent';
        console.log(`[Reminder Service] Admin email sent to ${adminEmail}`);
      } catch (adminError) {
        console.error(`[Reminder Service] Failed to send admin email to ${adminEmail}:`, adminError.message);
        if (adminEmailStatus !== 'sent') {
          errorMessage += `Admin email failed: ${adminError.message}. `;
        }
      }
    }

    // Log the reminder attempt
    const reminderLog = new ReminderLog({
      tenant: tenant._id,
      estate: estate._id,
      reminderType,
      tenantEmail: tenant.tenantEmail,
      adminEmail: adminEmails.join(', '),
      dueDate: tenant.nextDueDate,
      tenantEmailStatus,
      adminEmailStatus,
      errorMessage: errorMessage || undefined
    });

    await reminderLog.save();
    console.log(`[Reminder Service] Reminder log created for tenant ${tenant._id}`);
  } catch (error) {
    console.error(`[Reminder Service] Error sending reminder to tenant ${tenant._id}:`, error.message);
  }
};

/**
 * Get reminder history for a tenant
 * @param {String} tenantId - Tenant ID
 * @returns {Promise<Array>} Reminder logs
 */
const getTenantReminderHistory = async (tenantId) => {
  try {
    return await ReminderLog.find({ tenant: tenantId, isActive: true })
      .sort({ sentAt: -1 })
      .populate('tenant', 'tenantName tenantEmail unitLabel')
      .populate('estate', 'name');
  } catch (error) {
    console.error('[Reminder Service] Error fetching reminder history:', error.message);
    throw error;
  }
};

/**
 * Get pending reminders (not yet sent) for upcoming dates
 * @returns {Promise<Array>} Pending reminders
 */
const getPendingReminders = async () => {
  try {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const nextWeek = new Date(today);
    nextWeek.setDate(nextWeek.getDate() + 7);

    // Find tenants with due dates in next 7 days
    const tenants = await Tenant.find({
      isActive: true,
      status: { $in: ['occupied', 'pending'] },
      nextDueDate: {
        $gte: today,
        $lte: nextWeek
      },
      tenantEmail: { $exists: true, $ne: '' }
    }).populate('estate', 'name');

    // Filter out those that already have reminders
    const pending = [];
    for (const tenant of tenants) {
      const reminders = await ReminderLog.find({
        tenant: tenant._id,
        dueDate: tenant.nextDueDate,
        isActive: true
      });

      if (reminders.length === 0) {
        pending.push(tenant);
      }
    }

    return pending;
  } catch (error) {
    console.error('[Reminder Service] Error fetching pending reminders:', error.message);
    throw error;
  }
};

module.exports = {
  checkAndSendReminders,
  getTenantReminderHistory,
  getPendingReminders
};
