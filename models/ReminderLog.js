const mongoose = require('mongoose');

const ReminderLogSchema = new mongoose.Schema({
  tenant: {
    type: mongoose.Schema.ObjectId,
    ref: 'Tenant',
    required: true
  },
  estate: {
    type: mongoose.Schema.ObjectId,
    ref: 'Estate',
    required: true
  },
  reminderType: {
    type: String,
    enum: [
      // Legacy types (keeping for backward compatibility)
      '3-month', '2-month', '1-month', '2-week', '7-day', '3-day', '1-day',
      // New weekly-based reminder types
      'month1-reminder',
      'month2-week1', 'month2-week3',
      'month3-week1', 'month3-week2', 'month3-week3', 'month3-week4',
      'final-notice',
      // Overdue reminder types
      'overdue-week1', 'overdue-week2', 'overdue-week3', 'overdue-month1'
    ],
    required: true
  },
  tenantEmail: {
    type: String,
    required: true
  },
  adminEmail: {
    type: String,
    required: true
  },
  dueDate: {
    type: Date,
    required: true
  },
  sentAt: {
    type: Date,
    default: Date.now
  },
  tenantEmailStatus: {
    type: String,
    enum: ['sent', 'failed'],
    default: 'sent'
  },
  adminEmailStatus: {
    type: String,
    enum: ['sent', 'failed'],
    default: 'sent'
  },
  errorMessage: String,
  isActive: {
    type: Boolean,
    default: true
  }
}, {
  timestamps: true
});

// Index to check if reminder already sent
ReminderLogSchema.index(
  { tenant: 1, reminderType: 1, dueDate: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

module.exports = mongoose.model('ReminderLog', ReminderLogSchema);
