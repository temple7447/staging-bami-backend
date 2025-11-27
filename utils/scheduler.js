const schedule = require('node-schedule');
const { checkAndSendReminders, checkAndSendOverdueReminders } = require('./reminderService');

let reminderJob = null;
let overdueReminderJob = null;

/**
 * Initialize the reminder scheduler
 * Runs daily at 8 AM (08:00) for all reminders
 * Runs every 12 hours (08:00 and 20:00) for overdue reminders only
 */
const initializeScheduler = () => {
  try {
    // Schedule the full reminder check to run daily at 8 AM
    // Cron pattern: "0 8 * * *" = 8:00 AM every day
    reminderJob = schedule.scheduleJob('0 8 * * *', async () => {
      console.log('═'.repeat(60));
      console.log('📧 SCHEDULED REMINDER CHECK STARTED (ALL REMINDERS)');
      console.log('═'.repeat(60));
      await checkAndSendReminders();
      console.log('═'.repeat(60));
      console.log('📧 SCHEDULED REMINDER CHECK COMPLETED');
      console.log('═'.repeat(60));
    });

    // Schedule overdue reminder check to run every 12 hours (8 AM and 8 PM)
    // Cron pattern: "0 8,20 * * *" = 8:00 AM and 8:00 PM every day
    overdueReminderJob = schedule.scheduleJob('0 8,20 * * *', async () => {
      console.log('═'.repeat(60));
      console.log('⚠️  OVERDUE REMINDER CHECK STARTED');
      console.log('═'.repeat(60));
      await checkAndSendOverdueReminders();
      console.log('═'.repeat(60));
      console.log('⚠️  OVERDUE REMINDER CHECK COMPLETED');
      console.log('═'.repeat(60));
    });

    console.log('✅ Reminder scheduler initialized successfully');
    console.log('⏰ Full reminders checked daily at 08:00 AM');
    console.log('⚠️  Overdue reminders checked every 12 hours at 08:00 AM and 08:00 PM');

    return { reminderJob, overdueReminderJob };
  } catch (error) {
    console.error('❌ Error initializing reminder scheduler:', error.message);
    throw error;
  }
};

/**
 * Stop the reminder scheduler
 */
const stopScheduler = () => {
  try {
    if (reminderJob) {
      reminderJob.cancel();
      reminderJob = null;
    }
    if (overdueReminderJob) {
      overdueReminderJob.cancel();
      overdueReminderJob = null;
    }
    console.log('✅ All reminder schedulers stopped');
  } catch (error) {
    console.error('Error stopping scheduler:', error.message);
  }
};

/**
 * Manually trigger reminder check (useful for testing)
 */
const triggerReminderCheck = async () => {
  try {
    console.log('⚙️  Manually triggering reminder check...');
    await checkAndSendReminders();
    console.log('✅ Manual reminder check completed');
  } catch (error) {
    console.error('❌ Error during manual reminder check:', error.message);
    throw error;
  }
};

/**
 * Get scheduler status
 */
const getSchedulerStatus = () => {
  return {
    fullReminders: {
      isRunning: reminderJob !== null,
      nextInvocation: reminderJob ? reminderJob.nextInvocation() : null,
      schedule: '0 8 * * * (08:00 AM daily)'
    },
    overdueReminders: {
      isRunning: overdueReminderJob !== null,
      nextInvocation: overdueReminderJob ? overdueReminderJob.nextInvocation() : null,
      schedule: '0 8,20 * * * (08:00 AM and 08:00 PM daily)'
    }
  };
};

module.exports = {
  initializeScheduler,
  stopScheduler,
  triggerReminderCheck,
  getSchedulerStatus
};
