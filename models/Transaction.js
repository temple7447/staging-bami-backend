const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
  walletId: { type: mongoose.Schema.ObjectId, ref: 'Wallet' },
  tenant: { type: mongoose.Schema.ObjectId, ref: 'Tenant' },
  estate: { type: mongoose.Schema.ObjectId, ref: 'Estate' },
  amount: { type: Number, required: true, min: 0 },
  type: { type: String, enum: ['rent', 'utility', 'deposit', 'withdrawal', 'service_charge', 'caution_fee', 'legal_fee', 'maintenance', 'initial', 'bundle', 'other'], required: true },
  method: { type: String, enum: ['cash', 'transfer', 'card', 'bank', 'paystack', 'other'], default: 'transfer' },
  status: { type: String, enum: ['paid', 'pending', 'failed', 'completed'], default: 'paid' },
  reference: { type: String },
  periodMonth: { type: Number, min: 1, max: 12 },
  periodYear: { type: Number },
  notes: { type: String },
  description: { type: String },
  metadata: { type: mongoose.Schema.Types.Mixed },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
}, { timestamps: true });

// Performance indexes for common query patterns
TransactionSchema.index({ user: 1, createdAt: -1 });
TransactionSchema.index({ tenant: 1, createdAt: -1 });
TransactionSchema.index({ estate: 1, createdAt: -1 });
TransactionSchema.index({ tenant: 1, status: 1, createdAt: -1 });
TransactionSchema.index({ status: 1, createdAt: -1 });
TransactionSchema.index({ estate: 1, status: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', TransactionSchema);
