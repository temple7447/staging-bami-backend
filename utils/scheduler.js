const schedule = require('node-schedule');
const { checkAndSendReminders } = require('./reminderService');

let reminderJob = null;

/**
 * Initialize the reminder scheduler
 * Runs daily at 8 AM (08:00)
 */
const initializeScheduler = () => {
  try {
    // Schedule the reminder check to run daily at 8 AM
    // Cron pattern: "0 8 * * *" = 8:00 AM every day
    reminderJob = schedule.scheduleJob('0 8 * * *', async () => {
      console.log('═'.repeat(60));
      console.log('📧 SCHEDULED REMINDER CHECK STARTED');
      console.log('═'.repeat(60));
      await checkAndSendReminders();
      console.log('═'.repeat(60));
      console.log('📧 SCHEDULED REMINDER CHECK COMPLETED');
      console.log('═'.repeat(60));
    });

    console.log('✅ Reminder scheduler initialized successfully');
    console.log('⏰ Reminders will be checked daily at 08:00 AM');
    
    return reminderJob;
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
      console.log('✅ Reminder scheduler stopped');
      reminderJob = null;
    }
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
    isRunning: reminderJob !== null,
    nextInvocation: reminderJob ? reminderJob.nextInvocation() : null,
    schedule: '0 8 * * * (08:00 AM daily)'
  };
};

module.exports = {
  initializeScheduler,
  stopScheduler,
  triggerReminderCheck,
  getSchedulerStatus
};
