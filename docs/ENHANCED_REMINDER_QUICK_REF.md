# Enhanced Reminder System - Quick Reference

## 📅 Reminder Schedule

### Pre-Due Reminders (8 total)

| Days Before | Reminder Type | Month | Description |
|-------------|---------------|-------|-------------|
| 75 days | `month1-reminder` | Month 1 | Single reminder in month 1 |
| 53 days | `month2-week1` | Month 2 | Week 1 of month 2 |
| 38 days | `month2-week3` | Month 2 | Week 3 of month 2 |
| 30 days | `month3-week1` | Month 3 | Week 1 of month 3 |
| 23 days | `month3-week2` | Month 3 | Week 2 of month 3 |
| 16 days | `month3-week3` | Month 3 | Week 3 of month 3 |
| 9 days | `month3-week4` | Month 3 | Week 4 + **Visit Auto-Scheduled** |
| 2 days | `final-notice` | Final | Final notice before due date |

### Overdue Reminders (4 total)

| Days After | Reminder Type | Description |
|------------|---------------|-------------|
| 7 days | `overdue-week1` | 1 week overdue |
| 14 days | `overdue-week2` | 2 weeks overdue |
| 21 days | `overdue-week3` | 3 weeks overdue |
| 30 days | `overdue-month1` | 1 month overdue |

---

## 🏗️ Database Changes

### ReminderLog Model
**File**: `models/ReminderLog.js`

**New Fields**: None (existing model)
**Updated**: `reminderType` enum now has 19 types (7 legacy + 12 new)

```javascript
// New reminder types
'month1-reminder'
'month2-week1', 'month2-week3'
'month3-week1', 'month3-week2', 'month3-week3', 'month3-week4'
'final-notice'
'overdue-week1', 'overdue-week2', 'overdue-week3', 'overdue-month1'
```

### Visit Model (NEW)
**File**: `models/Visit.js`

```javascript
{
  tenant: ObjectId,
  estate: ObjectId,
  scheduledDate: Date,           // When visit is planned
  completedDate: Date,            // When visit happened
  status: 'scheduled' | 'completed' | 'cancelled',
  visitType: 'month3-followup' | 'overdue-collection' | 'general-inspection' | 'other',
  notes: String,
  assignedTo: ObjectId,           // Admin user assigned
  outcome: String,                // Visit result
  paymentReceived: Boolean,
  amountReceived: Number,
  isActive: Boolean
}
```

---

## 🔄 Key Functions

### reminderService.js

| Function | Purpose |
|----------|---------|
| `checkAndSendReminders()` | Main function - runs daily at 08:00 AM |
| `processReminderThreshold()` | Handles pre-due reminders |
| `processOverdueReminder()` | Handles overdue reminders |
| `sendTenantReminder()` | Sends pre-due emails |
| `sendOverdueReminder()` | Sends overdue emails |
| `scheduleVisit()` | Auto-creates visit record |

### emailService.js

| Function | Parameters | Description |
|----------|------------|-------------|
| `sendRentReminder(tenant, estate, daysRemaining)` | Positive = days until due<br>Negative = days overdue | Tenant email (regular or urgent) |
| `sendAdminRentReminder(adminEmail, tenant, estate, daysRemaining)` | Same as above | Admin alert email |

---

## 🚀 Testing Commands

### Syntax Check
```bash
cd /Users/temple/Documents/Bami/BamiHost-backend
node -c models/ReminderLog.js
node -c models/Visit.js
node -c utils/reminderService.js
node -c utils/emailService.js
```

### Test Module Loading
```bash
node -e "const {checkAndSendReminders} = require('./utils/reminderService'); console.log('✅ OK');"
```

### Manual Reminder Check
```bash
node -e "require('./utils/reminderService').checkAndSendReminders().then(() => console.log('Done'))"
```

###Check Reminder Types
```bash
node -e "const RL=require('./models/ReminderLog'); console.log(RL.schema.path('reminderType').enumValues)"
```

---

## 📊 MongoDB Queries

### Find New Reminder Types
```javascript
db.reminderlogs.find({ 
  reminderType: { $in: [
    'month1-reminder', 'month2-week1', 'month2-week3',
    'month3-week1', 'month3-week2', 'month3-week3', 'month3-week4',
    'final-notice', 
    'overdue-week1', 'overdue-week2', 'overdue-week3', 'overdue-month1'
  ]}
})
```

### Count Reminders by Type
```javascript
db.reminderlogs.aggregate([
  { $group: { _id: '$reminderType', count: { $sum: 1 } } },
  { $sort: { _id: 1 } }
])
```

### Find Scheduled Visits
```javascript
db.visits.find({ 
  status: 'scheduled',
  scheduledDate: { $gte: new Date() }
}).sort({ scheduledDate: 1 })
```

### Find Auto-Scheduled Visits
```javascript
db.visits.find({ visitType: 'month3-followup' })
```

###Find Overdue Reminders
```javascript
db.reminderlogs.find({ 
  reminderType: { $regex: /^overdue/ }
})
```

---

## ⏰ Scheduler

**Schedule**: Runs daily at 08:00 AM (server time)
**Cron Pattern**: `0 8 * * *`
**File**: `utils/scheduler.js`

The scheduler automatically:
1. Processes all 8 pre-due reminder thresholds
2. Processes all 4 overdue reminder thresholds  
3. Auto-schedules visits for month3-week4 reminders
4. Logs all activities

---

## 📧 Example Emails

### Pre-Due Email (Friendly)
- **Subject**: "Rent Payment Reminder - 30 Day(s) Until Due Date"
- **Header**: Blue (🔵 #007bff)
- **Tone**: Friendly, informational
- **Message**: "This is a friendly reminder..."

### Overdue Email (Urgent)
- **Subject**: "⚠️ URGENT: Rent Payment 7 Day(s) OVERDUE"
- **Header**: Red (🔴 #dc3545)
- **Tone**: Urgent, immediate action required
- **Message**: "IMMEDIATE ACTION REQUIRED..."

---

## 🎯 Visit Auto-Scheduling

**Trigger**: When `month3-week4` reminder is sent (9 days before due date)
**Schedule Date**: 3 days before rent due date
**Visit Type**: `month3-followup`
**Status**: `scheduled`
**Assignment**: None (requires manual admin assignment)

**Process**:
1. Reminder sent at 9 days before due date
2. Visit auto-created for 3 days before due date
3. Stored in `visits` collection
4. Admin can assign, complete, or cancel later

---

## 🔍 Troubleshooting

### Reminders Not Sending?
1. Check scheduler is running: `getSchedulerStatus()`
2. Verify tenant has `nextDueDate` and `tenantEmail`
3. Check `tenantisActive: true` and `status: 'occupied'` or `'pending'`
4. Review logs for `[Reminder Service]` messages

### Duplicate Reminders?
- Should not happen - unique index prevents this
- Check `ReminderLog` collection for duplicates

### Visits Not Creating?
- Only creates on `month3-week4` reminder
- Checks for existing visits to prevent duplicates
- Verify tenant has valid `nextDueDate`

### Overdue Not Working?
- Tenant must have `nextDueDate` in the past
- System checks for exact dates (7, 14, 21, 30 days ago)
- Runs daily, so may need to wait until next run

---

## 📝 Summary

✅ **12 reminder types** total (8 pre-due + 4 overdue)  
✅ **Weekly scheduling** in months 2 & 3  
✅ **Automatic visit creation** at 9 days before due  
✅ **Urgent styling** for overdue emails  
✅ **Backward compatible** with legacy types  
✅ **Production ready** ✨

**Status**: Implemented and tested  
**Version**: 3.0 (Enhanced Weekly System)  
**Date**: November 27, 2025
