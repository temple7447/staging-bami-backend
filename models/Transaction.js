const mongoose = require('mongoose');

const TransactionSchema = new mongoose.Schema({
  tenant: { type: mongoose.Schema.ObjectId, ref: 'Tenant', required: true },
  estate: { type: mongoose.Schema.ObjectId, ref: 'Estate', required: true },
  amount: { type: Number, required: true, min: 0 },
  type: { type: String, enum: ['rent','utility','deposit','other'], required: true },
  method: { type: String, enum: ['cash','transfer','card','bank','other'], default: 'transfer' },
  status: { type: String, enum: ['paid','pending','failed'], default: 'paid' },
  reference: { type: String },
  periodMonth: { type: Number, min: 1, max: 12 },
  periodYear: { type: Number },
  notes: { type: String },
  isActive: { type: Boolean, default: true },
  createdBy: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
  updatedBy: { type: mongoose.Schema.ObjectId, ref: 'User' }
}, { timestamps: true });

TransactionSchema.index({ tenant: 1, createdAt: -1 });

module.exports = mongoose.model('Transaction', TransactionSchema);
