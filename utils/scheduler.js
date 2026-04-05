const schedule = require('node-schedule');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { checkAndSendReminders, checkAndSendOverdueReminders } = require('./reminderService');
const { processPeriodicRentIncreases } = require('./rentIncreaseService');
const { sendMonthlyReport } = require('./monthlyReportService');
const { processMonthlyPayout, getPayoutStatus } = require('./vendorManagerPayoutService');
const { uploadToGoogleDrive } = require('./googleDriveUpload');

let reminderJob = null;
let overdueReminderJob = null;
let rentIncreaseJob = null;
let monthlyReportJob = null;
let vendorManagerPayoutJob = null;
let backupJob = null;

const backupDir = path.join(__dirname, '..', 'backups');

const performBackup = async () => {
  try {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const dbName = mongoose.connection.name || 'bamihustle';
    const backupFolderName = `${dbName}_backup_${timestamp}`;
    const backupPath = path.join(backupDir, backupFolderName);

    if (!fs.existsSync(backupPath)) {
      fs.mkdirSync(backupPath, { recursive: true });
    }

    const db = mongoose.connection.db;
    const collections = await db.listCollections().toArray();
    const masterBackup = { 
      timestamp: new Date().toISOString(), 
      database: dbName, 
      collections: {} 
    };

    console.log(`📦 Backing up ${collections.length} collections...`);

    for (const col of collections) {
      const name = col.name;
      const collection = db.collection(name);
      const data = await collection.find({}).toArray();
      
      // Save individual file
      fs.writeFileSync(path.join(backupPath, `${name}.json`), JSON.stringify(data, null, 2));
      
      // Add to master backup
      masterBackup.collections[name] = { count: data.length, data };
      console.log(`   ✅ ${name}: ${data.length} documents`);
    }

    // Save master backup file
    const masterFilePath = path.join(backupPath, 'all_collections.json');
    fs.writeFileSync(masterFilePath, JSON.stringify(masterBackup, null, 2));

    console.log(`✅ Local backup saved to: ${backupPath}`);

    // Upload to Google Drive if configured
    if (process.env.GOOGLE_REFRESH_TOKEN) {
      console.log('☁️  Starting Google Drive upload...');
      const targetFileName = `backup_${dbName}_${timestamp}.json`;
      const uploadResult = await uploadToGoogleDrive(masterFilePath, targetFileName);
      
      if (uploadResult.success) {
        console.log(`✅ Uploaded to Google Drive: ${uploadResult.link}`);
      } else {
        console.log(`⚠️  Google Drive upload failed: ${uploadResult.error}`);
      }
    } else {
      console.log('ℹ️  Google Drive upload skipped (no refresh token configured)');
    }

    return { 
      success: true, 
      path: backupPath, 
      masterFile: masterFilePath 
    };
  } catch (error) {
    console.error('❌ Backup failed:', error.message);
    return { success: false, error: error.message };
  }
};

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

    // Schedule periodic rent increases to run daily at 8 AM
    rentIncreaseJob = schedule.scheduleJob('0 8 * * *', async () => {
      console.log('═'.repeat(60));
      console.log('📈 PERIODIC RENT INCREASE PROCESS STARTED');
      console.log('═'.repeat(60));
      await processPeriodicRentIncreases();
      console.log('═'.repeat(60));
      console.log('📈 PERIODIC RENT INCREASE PROCESS COMPLETED');
      console.log('═'.repeat(60));
    });

    // Schedule monthly report to run on the 1st of every month at 9 AM
    // Cron pattern: "0 9 1 * *" = 9:00 AM on the 1st of every month
    monthlyReportJob = schedule.scheduleJob('0 9 1 * *', async () => {
      console.log('═'.repeat(60));
      console.log('📊 MONTHLY TENANT REPORT GENERATION STARTED');
      console.log('═'.repeat(60));
      const result = await sendMonthlyReport();
      if (result.success) {
        console.log(`✅ Monthly report sent: ${result.month}`);
        console.log(`📧 Sent to: ${result.sentTo}`);
        console.log(`👥 Total tenants: ${result.summary.totalTenants}`);
        console.log(`💰 Total paid: ₦${result.summary.totalPaidThisMonth.toLocaleString()}`);
      } else {
        console.log(`❌ Monthly report failed: ${result.error}`);
      }
      console.log('═'.repeat(60));
      console.log('📊 MONTHLY TENANT REPORT GENERATION COMPLETED');
      console.log('═'.repeat(60));
    });

    // Schedule vendor/manager monthly payout on the 1st of every month at 10 AM
    // Cron pattern: "0 10 1 * *" = 10:00 AM on the 1st of every month
    vendorManagerPayoutJob = schedule.scheduleJob('0 10 1 * *', async () => {
      console.log('═'.repeat(60));
      console.log('💰 VENDOR/MANAGER MONTHLY PAYOUT STARTED');
      console.log('═'.repeat(60));
      const result = await processMonthlyPayout();
      if (result.success) {
        console.log(`✅ Payout processed: ₦${result.currentAmount.toLocaleString()} per user`);
        console.log(`👥 Successful payouts: ${result.summary.successfulPayouts}`);
        console.log(`💵 Total distributed: ₦${result.summary.totalDistributed.toLocaleString()}`);
        if (result.summary.failedPayouts > 0) {
          console.log(`⚠️  Failed payouts: ${result.summary.failedPayouts}`);
        }
      } else {
        console.log(`❌ Payout failed: ${result.message}`);
      }
      console.log('═'.repeat(60));
      console.log('💰 VENDOR/MANAGER MONTHLY PAYOUT COMPLETED');
      console.log('═'.repeat(60));
    });

    // Schedule automatic database backup every day at 2 AM
    // Cron pattern: "0 2 * * *" = 2:00 AM every day
    backupJob = schedule.scheduleJob('0 2 * * *', async () => {
      console.log('═'.repeat(60));
      console.log('💾 AUTOMATIC DATABASE BACKUP STARTED');
      console.log('═'.repeat(60));
      const result = await performBackup();
      if (result.success) {
        console.log(`✅ Backup completed: ${result.path}`);
      } else {
        console.log(`❌ Backup failed: ${result.error}`);
      }
      console.log('═'.repeat(60));
      console.log('💾 AUTOMATIC DATABASE BACKUP COMPLETED');
      console.log('═'.repeat(60));
    });

    console.log('✅ Reminder scheduler initialized successfully');
    console.log('⏰ Full reminders and Rent Increases checked daily at 08:00 AM');
    console.log('⚠️  Overdue reminders checked every 12 hours at 08:00 AM and 08:00 PM');
    console.log('📊 Monthly tenant report sent on the 1st of every month at 09:00 AM');
    console.log('💰 Vendor/Manager monthly payout on the 1st of every month at 10:00 AM');
    console.log('💾 Automatic database backup daily at 02:00 AM');

    return { reminderJob, overdueReminderJob, rentIncreaseJob, monthlyReportJob, vendorManagerPayoutJob, backupJob };
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
    if (rentIncreaseJob) {
      rentIncreaseJob.cancel();
      rentIncreaseJob = null;
    }
    if (monthlyReportJob) {
      monthlyReportJob.cancel();
      monthlyReportJob = null;
    }
    if (vendorManagerPayoutJob) {
      vendorManagerPayoutJob.cancel();
      vendorManagerPayoutJob = null;
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
    await processPeriodicRentIncreases();
    console.log('✅ Manual reminder check completed');
  } catch (error) {
    console.error('❌ Error during manual reminder check:', error.message);
    throw error;
  }
};

/**
 * Manually trigger monthly report (useful for testing)
 */
const triggerMonthlyReport = async () => {
  try {
    console.log('⚙️  Manually triggering monthly report...');
    const result = await sendMonthlyReport();
    console.log('✅ Manual monthly report completed:', result);
    return result;
  } catch (error) {
    console.error('❌ Error during manual monthly report:', error.message);
    throw error;
  }
};

/**
 * Manually trigger vendor/manager payout (useful for testing)
 */
const triggerVendorManagerPayout = async () => {
  try {
    console.log('⚙️  Manually triggering vendor/manager payout...');
    const result = await processMonthlyPayout();
    console.log('✅ Manual vendor/manager payout completed:', result);
    return result;
  } catch (error) {
    console.error('❌ Error during manual vendor/manager payout:', error.message);
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
    },
    rentIncreases: {
      isRunning: rentIncreaseJob !== null,
      nextInvocation: rentIncreaseJob ? rentIncreaseJob.nextInvocation() : null,
      schedule: '0 8 * * * (08:00 AM daily)'
    },
    monthlyReport: {
      isRunning: monthlyReportJob !== null,
      nextInvocation: monthlyReportJob ? monthlyReportJob.nextInvocation() : null,
      schedule: '0 9 1 * * (09:00 AM on 1st of every month)'
    },
    vendorManagerPayout: {
      isRunning: vendorManagerPayoutJob !== null,
      nextInvocation: vendorManagerPayoutJob ? vendorManagerPayoutJob.nextInvocation() : null,
      schedule: '0 10 1 * * (10:00 AM on 1st of every month)'
    }
  };
};

module.exports = {
  initializeScheduler,
  stopScheduler,
  triggerReminderCheck,
  triggerMonthlyReport,
  getSchedulerStatus,
  triggerVendorManagerPayout,
  performBackup
};
