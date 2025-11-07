const mongoose = require('mongoose');

const HistorySchema = new mongoose.Schema({
  event: {
    type: String,
    enum: ['created', 'moved_in', 'moved_out', 'rent_update', 'payment', 'note'],
    required: true
  },
  note: String,
  meta: Object,
  createdAt: { type: Date, default: Date.now },
  createdBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
}, { _id: false });

const TenantSchema = new mongoose.Schema({
  estate: {
    type: mongoose.Schema.ObjectId,
    ref: 'Estate',
    required: true
  },
  unitLabel: {
    type: String,
    required: [true, 'Unit label is required'],
    trim: true,
    maxlength: [100, 'Unit label cannot be more than 100 characters']
  },
  tenantName: {
    type: String,
    required: [true, 'Tenant name is required'],
    trim: true,
    maxlength: [150, 'Tenant name cannot be more than 150 characters']
  },
  tenantEmail: {
    type: String,
    lowercase: true,
    trim: true
  },
  tenantPhone: {
    type: String,
    trim: true
  },
  rentAmount: {
    type: Number,
    required: [true, 'Rent amount is required'],
    min: [0, 'Rent amount cannot be negative']
  },
  tenantType: {
    type: String,
    enum: ['new', 'existing', 'renewal', 'transfer'],
    default: 'new'
  },
  status: {
    type: String,
    enum: ['occupied', 'vacant', 'pending', 'evicted'],
    default: 'occupied'
  },
  electricMeterNumber: {
    type: String,
    trim: true
  },
  nextDueDate: {
    type: Date
  },
  // Optional link to a login user account for this tenant
  user: { type: mongoose.Schema.ObjectId, ref: 'User' },
  history: [HistorySchema],
  isActive: {
    type: Boolean,
    default: true
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  updatedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true,
});

// Unique unit per active tenant in an estate
TenantSchema.index(
  { estate: 1, unitLabel: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

module.exports = mongoose.model('Tenant', TenantSchema);
