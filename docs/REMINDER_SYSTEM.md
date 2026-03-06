# Rent Payment Reminder System

## Overview
The automated rent payment reminder system sends email notifications to tenants and administrators at 7 days, 3 days, and 1 day before the tenant's rent due date.

## Architecture

### Components

#### 1. **ReminderLog Model** (`models/ReminderLog.js`)
Tracks all sent reminders to prevent duplicates and maintain a history.
- Stores tenant, estate, reminder type, and email statuses
- Prevents duplicate reminders for the same tenant and due date
- Tracks success/failure of emails sent

#### 2. **Reminder Service** (`utils/reminderService.js`)
Core business logic for checking and sending reminders.
- `checkAndSendReminders()` - Main function that checks for upcoming due dates
- `processReminderThreshold()` - Processes reminders for a specific day threshold (7, 3, or 1 day)
- `sendTenantReminder()` - Sends emails to both tenant and admin users
- `getTenantReminderHistory()` - Retrieves reminder history for a tenant
- `getPendingReminders()` - Gets upcoming reminders not yet sent

#### 3. **Scheduler** (`utils/scheduler.js`)
Manages the cron job that triggers daily reminder checks.
- `initializeScheduler()` - Starts the scheduler (runs at 08:00 AM daily)
- `stopScheduler()` - Stops the scheduler
- `triggerReminderCheck()` - Manually trigger reminder check (useful for testing)
- `getSchedulerStatus()` - Returns current scheduler status

#### 4. **Email Service Extensions** (`utils/emailService.js`)
New email templates for reminders:
- `sendRentReminder(tenant, estate, daysRemaining)` - Sends reminder email to tenant
- `sendAdminRentReminder(adminEmail, tenant, estate, daysRemaining)` - Sends alert to admin

## How It Works

### Daily Execution Flow

1. **Scheduler Trigger** (08:00 AM daily)
   - The scheduler kicks off `checkAndSendReminders()`

2. **Threshold Processing**
   - Checks for tenants with due dates in:
     - 7 days from today
     - 3 days from today
     - 1 day from today

3. **Tenant Discovery**
   - Finds active tenants with status 'occupied' or 'pending'
   - Filters those with valid email addresses

4. **Duplicate Check**
   - Queries ReminderLog to prevent sending duplicate reminders
   - Only sends if no previous reminder for that type/due date exists

5. **Email Sending**
   - Sends personalized email to tenant
   - Sends alert email to all admin/super_admin users
   - Logs the attempt in ReminderLog (success or failure)

### Email Templates

#### Tenant Email
- Friendly reminder format
- Shows days remaining, estate name, unit, and rent amount
- Includes due date
- Encourages on-time payment

#### Admin Email
- Alert format with yellow accent
- Shows tenant contact info
- Displays all relevant payment details
- Helps admins track upcoming payments

## Configuration

### Environment Variables
Ensure your `.env` file has email configuration:
```
EMAIL_SERVICE=gmail
EMAIL_PORT=587
EMAIL_USER=your-email@gmail.com
EMAIL_PASSWORD=your-app-specific-password
EMAIL_FROM=your-email@gmail.com
```

### Schedule Timing
- **Default:** 08:00 AM (8:00 AM) daily
- **Cron Pattern:** `0 8 * * *`
- To change timing, edit `utils/scheduler.js` line 14

## API Endpoints (Optional)

You can optionally add these endpoints to your routes for management:

```javascript
// GET /api/reminders/status - Check scheduler status
// GET /api/reminders/tenant/:tenantId - Get reminder history for a tenant
// GET /api/reminders/pending - Get pending reminders
// POST /api/reminders/trigger - Manually trigger reminder check (admin only)
```

## Database Indexes

ReminderLog has a unique compound index on:
- `tenant` + `reminderType` + `dueDate`

This ensures only one reminder of each type per tenant per due date.

## Error Handling

- Failed tenant emails are logged but don't stop admin emails
- Failed admin emails don't prevent the process from continuing
- All errors are logged in ReminderLog with error messages
- Console errors are logged for debugging

## Monitoring

Monitor the system by checking:

1. **Server Logs** - Look for `[Reminder Service]` prefixed messages
2. **ReminderLog Collection** - Check MongoDB for reminder records
3. **Email Status** - Verify `tenantEmailStatus` and `adminEmailStatus` fields
4. **Scheduler Status** - Call `getSchedulerStatus()` from scheduler module

## Testing

### Manual Trigger
```javascript
const { triggerReminderCheck } = require('./utils/scheduler');

// In your route or test file
await triggerReminderCheck();
```

### Check Scheduler Status
```javascript
const { getSchedulerStatus } = require('./utils/scheduler');

const status = getSchedulerStatus();
console.log(status);
// Output: {
//   isRunning: true,
//   nextInvocation: Date,
//   schedule: '0 8 * * * (08:00 AM daily)'
// }
```

## Troubleshooting

### Reminders Not Sending
1. Check email configuration in `.env`
2. Verify tenant has `tenantEmail` field populated
3. Check that tenant status is 'occupied' or 'pending'
4. Review server logs for `[Reminder Service]` errors

### Duplicate Emails
1. This shouldn't happen - ReminderLog prevents duplicates
2. If it does, check the unique index on ReminderLog

### Wrong Reminders Sent
1. Verify the cron pattern in `scheduler.js`
2. Check server timezone (scheduler uses server time)
3. Review the reminder threshold dates in `reminderService.js`

## Future Enhancements

- SMS reminders in addition to email
- Customizable reminder times per estate
- Reminder templates customization per estate
- Retry mechanism for failed emails
- Webhook notifications instead of/in addition to email
- Integration with payment gateway confirmations
