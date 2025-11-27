const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const ReminderLog = require('../models/ReminderLog');
const User = require('../models/User');
const { sendRentReminder, sendAdminRentReminder } = require('./emailService');

/**
 * Check for upcoming due dates and send reminders
 * Sends reminders at: Month 1 (1 reminder), Month 2 (2 weekly), Month 3 (4 weekly), Final Notice
 * Also checks for overdue payments and sends overdue reminders
 */
const checkAndSendReminders = async () => {
  try {
    console.log('[Reminder Service] Starting reminder check at', new Date().toISOString());

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Define reminder thresholds (weekly-based schedule)
    const reminderThresholds = [
      // Month 1: 1 reminder (75 days = ~2.5 months)
      { days: 75, type: 'month1-reminder' },

      // Month 2: 2 weekly reminders
      { days: 53, type: 'month2-week1' },        // Week 1 of month 2
      { days: 38, type: 'month2-week3' },        // Week 3 of month 2

      // Month 3: 4 weekly reminders
      { days: 30, type: 'month3-week1' },        // Week 1
      { days: 23, type: 'month3-week2' },        // Week 2
      { days: 16, type: 'month3-week3' },        // Week 3
      { days: 9, type: 'month3-week4' },         // Week 4 (+ visit scheduling)

      // Final notice
      { days: 2, type: 'final-notice' }          // 2 days before due
    ];

    // Define overdue reminder thresholds
    const overdueThresholds = [
      { days: -7, type: 'overdue-week1' },       // 1 week overdue
      { days: -14, type: 'overdue-week2' },      // 2 weeks overdue
      { days: -21, type: 'overdue-week3' },      // 3 weeks overdue
      { days: -30, type: 'overdue-month1' }      // 1 month overdue
    ];

    // Process regular reminders (before due date)
    for (const threshold of reminderThresholds) {
      await processReminderThreshold(today, threshold.days, threshold.type);
    }

    // Process overdue reminders (after due date)
    for (const threshold of overdueThresholds) {
      await processOverdueReminder(today, threshold.days, threshold.type);
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

    // Schedule visit for month3-week4 reminder
    if (reminderType === 'month3-week4') {
      await scheduleVisit(tenant, estate);
    }
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

/**
 * Process overdue reminders for tenants with past due dates
 * @param {Date} today - Today's date
 * @param {Number} daysOffset - Negative number of days after due date
 * @param {String} reminderType - Type of overdue reminder
 */
const processOverdueReminder = async (today, daysOffset, reminderType) => {
  try {
    // Calculate target date (in the past since daysOffset is negative)
    const targetDate = new Date(today);
    targetDate.setDate(targetDate.getDate() + daysOffset);

    const targetDateStart = new Date(targetDate);
    targetDateStart.setHours(0, 0, 0, 0);

    const targetDateEnd = new Date(targetDate);
    targetDateEnd.setHours(23, 59, 59, 999);

    console.log(`[Reminder Service] Processing ${reminderType} reminders for overdue date:`, {
      start: targetDateStart.toISOString(),
      end: targetDateEnd.toISOString()
    });

    // Find tenants with due dates that match the overdue threshold
    const tenants = await Tenant.find({
      isActive: true,
      status: { $in: ['occupied', 'pending'] },
      nextDueDate: {
        $gte: targetDateStart,
        $lte: targetDateEnd
      },
      tenantEmail: { $exists: true, $ne: '' }
    }).populate('estate');

    console.log(`[Reminder Service] Found ${tenants.length} tenants for ${reminderType} overdue reminder`);

    for (const tenant of tenants) {
      await sendOverdueReminder(tenant, reminderType, Math.abs(daysOffset));
    }
  } catch (error) {
    console.error(`[Reminder Service] Error processing ${reminderType} overdue reminders:`, error.message);
  }
};

/**
 * Send overdue reminder to tenant and admin
 * @param {Object} tenant - Tenant document
 * @param {String} reminderType - Type of reminder
 * @param {Number} daysOverdue - Days past due date
 */
const sendOverdueReminder = async (tenant, reminderType, daysOverdue) => {
  try {
    const estate = tenant.estate;

    // Check if overdue reminder already sent
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
      console.log(`[Reminder Service] Overdue reminder already sent for tenant ${tenant._id} - skipping`);
      return;
    }

    // Get admin users
    const adminUsers = await User.find({
      isActive: true,
      role: { $in: ['super_admin', 'admin'] }
    }).select('email name');

    let tenantEmailStatus = 'failed';
    let adminEmailStatus = 'failed';
    let errorMessage = '';

    // Send overdue email to tenant (using daysOverdue as negative to indicate overdue)
    try {
      await sendRentReminder(tenant, estate, -daysOverdue);
      tenantEmailStatus = 'sent';
      console.log(`[Reminder Service] Overdue tenant email sent for ${tenant._id}`);
    } catch (tenantError) {
      console.error(`[Reminder Service] Failed to send overdue tenant email:`, tenantError.message);
      errorMessage += `Tenant email failed: ${tenantError.message}. `;
    }

    // Send overdue alerts to admins
    const adminEmails = adminUsers.map(user => user.email);
    for (const adminEmail of adminEmails) {
      try {
        await sendAdminRentReminder(adminEmail, tenant, estate, -daysOverdue);
        adminEmailStatus = 'sent';
        console.log(`[Reminder Service] Overdue admin email sent to ${adminEmail}`);
      } catch (adminError) {
        console.error(`[Reminder Service] Failed to send overdue admin email to ${adminEmail}:`, adminError.message);
        if (adminEmailStatus !== 'sent') {
          errorMessage += `Admin email failed: ${adminError.message}. `;
        }
      }
    }

    // Log the overdue reminder
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
    console.log(`[Reminder Service] Overdue reminder log created for tenant ${tenant._id}`);
  } catch (error) {
    console.error(`[Reminder Service] Error sending overdue reminder to tenant ${tenant._id}:`, error.message);
  }
};

/**
 * Schedule a visit for a tenant (called when month3-week4 reminder is sent)
 * @param {Object} tenant - Tenant document
 * @param {Object} estate - Estate document
 */
const scheduleVisit = async (tenant, estate) => {
  try {
    const Visit = require('../models/Visit');

    // Check if visit already scheduled for this tenant near the due date
    const existingVisit = await Visit.findOne({
      tenant: tenant._id,
      status: { $in: ['scheduled', 'completed'] },
      scheduledDate: {
        $gte: new Date(tenant.nextDueDate).setDate(new Date(tenant.nextDueDate).getDate() - 10),
        $lte: new Date(tenant.nextDueDate).setDate(new Date(tenant.nextDueDate).getDate() + 5)
      }
    });

    if (existingVisit) {
      console.log(`[Reminder Service] Visit already scheduled for tenant ${tenant._id} - skipping`);
      return;
    }

    // Schedule visit for 2-3 days before due date
    const scheduledDate = new Date(tenant.nextDueDate);
    scheduledDate.setDate(scheduledDate.getDate() - 3);

    const visit = new Visit({
      tenant: tenant._id,
      estate: estate._id,
      scheduledDate,
      status: 'scheduled',
      visitType: 'month3-followup',
      notes: `Automatically scheduled visit during month 3 week 4 reminder for rent collection follow-up`
    });

    await visit.save();
    console.log(`[Reminder Service] Visit scheduled for tenant ${tenant._id} on ${scheduledDate.toISOString()}`);

    // TODO: Send visit notification email to assigned admin
  } catch (error) {
    console.error(`[Reminder Service] Error scheduling visit for tenant ${tenant._id}:`, error.message);
  }
};

/**
 * Check and send ONLY overdue reminders (runs every 12 hours)
 * This is separate from the full reminder check to provide frequent overdue notifications
 */
const checkAndSendOverdueReminders = async () => {
  try {
    console.log('[Reminder Service] Starting OVERDUE-ONLY reminder check at', new Date().toISOString());

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Define overdue reminder thresholds
    const overdueThresholds = [
      { days: -7, type: 'overdue-week1' },       // 1 week overdue
      { days: -14, type: 'overdue-week2' },      // 2 weeks overdue
      { days: -21, type: 'overdue-week3' },      // 3 weeks overdue
      { days: -30, type: 'overdue-month1' }      // 1 month overdue
    ];

    // Process overdue reminders only
    for (const threshold of overdueThresholds) {
      await processOverdueReminder(today, threshold.days, threshold.type);
    }

    console.log('[Reminder Service] Overdue reminder check completed successfully');
  } catch (error) {
    console.error('[Reminder Service] Error during overdue reminder check:', error.message);
  }
};

module.exports = {
  checkAndSendReminders,
  checkAndSendOverdueReminders,
  getTenantReminderHistory,
  getPendingReminders
};
