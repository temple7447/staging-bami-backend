const mongoose = require('mongoose');

const PaymentSchema = new mongoose.Schema({
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
  admin: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  paymentType: {
    type: String,
    enum: ['deposit', 'rent', 'service_charge', 'security_charge', 'caution_fee', 'legal_fee', 'utilities', 'maintenance', 'initial', 'other'],
    required: true
  },
  amount: {
    type: Number,
    required: [true, 'Amount is required'],
    min: [1, 'Amount must be greater than 0']
  },
  currency: {
    type: String,
    default: 'NGN',
    enum: ['NGN'],
    immutable: true
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  // Paystack Integration Fields
  paystackReference: {
    type: String,
    unique: true,
    sparse: true
  },
  paystackAccessCode: {
    type: String
  },
  paystackStatus: {
    type: String,
    enum: ['success', 'failed', 'abandoned'],
    default: null
  },
  paystackResponse: {
    type: mongoose.Schema.Types.Mixed
  },
  // Payment Status
  paymentStatus: {
    type: String,
    enum: ['pending', 'initiated', 'completed', 'failed', 'refunded'],
    default: 'pending'
  },
  paymentMethod: {
    type: String,
    enum: ['paystack', 'bank_transfer', 'cash', 'check'],
    default: 'paystack'
  },
  // Transaction Details
  transactionId: {
    type: String,
    unique: true,
    sparse: true
  },
  receiptUrl: {
    type: String
  },
  paymentDate: {
    type: Date
  },
  // Deposit Specific
  isDeposit: {
    type: Boolean,
    default: false
  },
  depositRefundable: {
    type: Boolean,
    default: true
  },
  depositRefundedDate: {
    type: Date
  },
  depositRefundedAmount: {
    type: Number,
    default: 0
  },
  // Reconciliation
  reconciled: {
    type: Boolean,
    default: false
  },
  reconciledDate: {
    type: Date
  },
  reconciledBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  // Notes and References
  notes: {
    type: String,
    maxlength: [1000, 'Notes cannot be more than 1000 characters']
  },
  internalReference: {
    type: String
  },
  // Failure Details
  failureReason: {
    type: String
  },
  failureCode: {
    type: String
  },
  retryCount: {
    type: Number,
    default: 0,
    max: [3, 'Maximum retry attempts exceeded']
  },
  lastRetryDate: {
    type: Date
  },
  // Metadata
  ipAddress: String,
  userAgent: String,
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
  timestamps: true
});

// Indexes for efficient querying
PaymentSchema.index({ tenant: 1, estate: 1, paymentStatus: 1 });
PaymentSchema.index({ createdAt: -1 });
PaymentSchema.index({ paymentDate: -1 });
PaymentSchema.index({ isDeposit: 1, depositRefundable: 1 });

// Calculate refund status
PaymentSchema.virtual('canRefund').get(function () {
  return this.isDeposit && this.depositRefundable && !this.depositRefundedDate;
});

// Format currency display
PaymentSchema.methods.getFormattedAmount = function () {
  const formatter = new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: this.currency
  });
  return formatter.format(this.amount);
};

// Get payment status badge
PaymentSchema.methods.getStatusBadge = function () {
  const badges = {
    'pending': '⏳ Pending',
    'initiated': '🔄 Processing',
    'completed': '✅ Completed',
    'failed': '❌ Failed',
    'refunded': '↩️ Refunded'
  };
  return badges[this.paymentStatus] || this.paymentStatus;
};

module.exports = mongoose.model('Payment', PaymentSchema);
