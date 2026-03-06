# Rent Reminder System - Quick Start Guide

## ✅ Implementation Complete

The automated rent payment reminder system has been successfully implemented in your BamiHustle backend!

## 📦 What Was Added

### New Files Created:
1. **`models/ReminderLog.js`** - Tracks sent reminders and prevents duplicates
2. **`utils/reminderService.js`** - Core logic for checking and sending reminders
3. **`utils/scheduler.js`** - Manages daily cron job execution
4. **`REMINDER_SYSTEM.md`** - Complete documentation

### Files Modified:
1. **`utils/emailService.js`** - Added 2 new email functions
   - `sendRentReminder()` - Email to tenant
   - `sendAdminRentReminder()` - Email to admin
2. **`server.js`** - Initialize scheduler on startup

### Package Installed:
- **`node-schedule`** - For cron job scheduling

## 🚀 How to Use

### 1. Ensure Email Configuration
Update your `.env` file:
```env
EMAIL_SERVICE=gmail
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-specific-password
EMAIL_FROM=your-email@gmail.com
```

### 2. Start Your Server
The scheduler automatically initializes when the server starts:
```bash
npm run dev
```

You'll see in the console:
```
✅ Reminder scheduler initialized successfully
⏰ Reminders will be checked daily at 08:00 AM
```

### 3. Set Tenant Due Dates
Make sure tenants have `nextDueDate` set in the database:
```javascript
tenant.nextDueDate = new Date('2025-11-20'); // Example date
```

### 4. Automatic Reminders
The system automatically sends reminders at:
- **7 days** before due date
- **3 days** before due date  
- **1 day** before due date

All at 08:00 AM daily.

## 📧 Email Recipients

### Tenant Receives:
- Friendly reminder email
- Shows days remaining, estate, unit, and amount
- Encourages on-time payment

### Admin Receives:
- Alert email for each upcoming rent due
- Shows tenant contact info and payment details
- One email per tenant per reminder period

## 🔍 Monitoring

### Check Server Logs
Look for logs like:
```
[Reminder Service] Processing 7-day reminders...
[Reminder Service] Found 3 tenants for 7-day reminder
[Reminder Service] Tenant email sent for [ID]
[Reminder Service] Admin email sent to admin@example.com
```

### Query Reminder History
```javascript
const ReminderLog = require('./models/ReminderLog');

// Get all reminders for a tenant
const reminders = await ReminderLog.find({ tenant: tenantId });

// Get failed reminders
const failed = await ReminderLog.find({ tenantEmailStatus: 'failed' });
```

## 🧪 Testing

### Manual Trigger (Testing)
```javascript
const { triggerReminderCheck } = require('./utils/scheduler');

// Add this to a test route
app.get('/api/test/send-reminders', async (req, res) => {
  try {
    await triggerReminderCheck();
    res.json({ success: true, message: 'Reminders sent' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});
```

### Check Scheduler Status
```javascript
const { getSchedulerStatus } = require('./utils/scheduler');

app.get('/api/test/scheduler-status', (req, res) => {
  const status = getSchedulerStatus();
  res.json(status);
  // Returns: { isRunning: true, nextInvocation: Date, schedule: '0 8 * * *' }
});
```

## ⚙️ Configuration Options

### Change Reminder Time
Edit `utils/scheduler.js` line 14:
```javascript
// Current: 08:00 AM daily
reminderJob = schedule.scheduleJob('0 8 * * *', async () => {

// Change to 06:00 AM:
reminderJob = schedule.scheduleJob('0 6 * * *', async () => {

// Change to 3:30 PM:
reminderJob = schedule.scheduleJob('30 15 * * *', async () => {
```

### Add/Remove Reminder Days
Edit `utils/reminderService.js` line 18-23:
```javascript
const reminderThresholds = [
  { days: 7, type: '7-day' },
  { days: 3, type: '3-day' },
  { days: 1, type: '1-day' },
  // Add more: { days: 5, type: '5-day' }
];
```

## 🐛 Troubleshooting

### Reminders Not Sending?
1. ✅ Check email config in `.env`
2. ✅ Verify tenant `tenantEmail` field is populated
3. ✅ Check tenant status is 'occupied' or 'pending'
4. ✅ Review server logs for `[Reminder Service]` errors
5. ✅ Verify MongoDB connection is working

### Getting Duplicates?
This shouldn't happen due to ReminderLog unique index, but if it does:
1. Rebuild the index in MongoDB:
   ```javascript
   db.reminderlogs.dropIndex("tenant_1_reminderType_1_dueDate_1");
   db.reminderlogs.createIndex(
     { tenant: 1, reminderType: 1, dueDate: 1 },
     { unique: true, partialFilterExpression: { isActive: true } }
   );
   ```

### Email Content Issues?
- Tenant email template: `utils/emailService.js` line 138-155
- Admin email template: `utils/emailService.js` line 168-187

## 📊 Database Schema

### ReminderLog Fields:
```javascript
{
  tenant: ObjectId,           // Tenant reference
  estate: ObjectId,           // Estate reference
  reminderType: String,       // '7-day', '3-day', or '1-day'
  tenantEmail: String,        // Email sent to
  adminEmail: String,         // Admin emails (comma-separated)
  dueDate: Date,             // Original rent due date
  sentAt: Date,              // When reminder was sent
  tenantEmailStatus: String,  // 'sent' or 'failed'
  adminEmailStatus: String,   // 'sent' or 'failed'
  errorMessage: String,       // Error details if failed
  isActive: Boolean,          // Soft delete flag
  createdAt: Date,           // Created timestamp
  updatedAt: Date            // Updated timestamp
}
```

## 📝 Next Steps (Optional)

1. Create API endpoints for managing reminders
2. Add SMS reminders in addition to email
3. Implement customizable reminder templates per estate
4. Add retry mechanism for failed emails
5. Integrate with payment confirmation webhooks

## ✨ Summary

Your rent reminder system is now live! It will:
- ✅ Run automatically every day at 08:00 AM
- ✅ Send emails to tenants 7, 3, and 1 day before rent is due
- ✅ Notify admins of upcoming payments
- ✅ Prevent duplicate emails
- ✅ Track all reminder history

No further action needed unless you want to customize the timing or add additional features!
