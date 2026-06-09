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
  unit: {
    type: mongoose.Schema.ObjectId,
    ref: 'Unit',
    required: [true, 'Unit is required']
  },
  unitLabel: {
    type: String,
    trim: true,
    default: ''
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
    default: 0,
    min: [0, 'Rent amount cannot be negative']
  },
  serviceChargeAmount: {
    type: Number,
    default: 0,
    min: [0, 'Service charge amount cannot be negative']
  },
  tenantType: {
    type: String,
    enum: ['new', 'existing', 'transfer'],
    default: 'new'
  },
  status: {
    type: String,
    enum: ['occupied', 'vacant', 'pending', 'evicted'],
    default: 'occupied'
  },
  electricMeterNumber: {
    type: String,
    trim: true,
    default: ''
  },
  entryDate: {
    type: Date
  },
  nextDueDate: {
    type: Date
  },
  // Optional link to a login user account for this tenant
  user: { type: mongoose.Schema.ObjectId, ref: 'User' },
  // Profile image (Cloudinary)
  profileImageUrl: { type: String },
  profileImagePublicId: { type: String },
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
  // Outstanding balances recorded at onboarding for existing tenants
  rentOutstanding: {
    type: Number,
    default: 0,
    min: 0
  },
  serviceChargeOutstanding: {
    type: Number,
    default: 0,
    min: 0
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
  {
    unique: true,
    partialFilterExpression: { isActive: true }
  }
);

// Performance indexes for common query patterns
TenantSchema.index({ estate: 1, isActive: 1, status: 1 });
TenantSchema.index({ estate: 1, nextDueDate: 1 });
TenantSchema.index({ tenantEmail: 1 }, { sparse: true });
TenantSchema.index({ tenantPhone: 1 }, { sparse: true });
TenantSchema.index({ isActive: 1, nextDueDate: 1 });
TenantSchema.index({ status: 1, nextDueDate: 1 });

module.exports = mongoose.model('Tenant', TenantSchema);
