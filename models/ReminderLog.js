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
    enum: ['7-day', '3-day', '1-day'],
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
