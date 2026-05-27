const mongoose = require('mongoose');

const BankDepositSchema = new mongoose.Schema({
  user: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: true
  },
  tenant: {
    type: mongoose.Schema.ObjectId,
    ref: 'Tenant'
  },
  amount: {
    type: Number,
    required: [true, 'Deposit amount is required'],
    min: [1, 'Amount must be greater than 0']
  },
  // Proof of payment image uploaded to Cloudinary
  proofImageUrl: {
    type: String,
    required: [true, 'Proof of payment image is required']
  },
  proofImagePublicId: {
    type: String
  },
  // Bank details shown at time of deposit
  bankName: { type: String, default: 'UBA' },
  accountNumber: { type: String, default: '1027525073' },
  accountName: { type: String, default: 'UNITED TRADING INTEGRATED VENTURES ACC 1' },

  status: {
    type: String,
    enum: ['pending', 'approved', 'rejected'],
    default: 'pending'
  },
  adminNote: {
    type: String,
    trim: true
  },
  reviewedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  reviewedAt: {
    type: Date
  },
  // Reference the wallet credit transaction if approved
  walletTransactionRef: {
    type: String
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  }
}, { timestamps: true });

BankDepositSchema.index({ user: 1, status: 1, createdAt: -1 });
BankDepositSchema.index({ status: 1, createdAt: -1 });

module.exports = mongoose.model('BankDeposit', BankDepositSchema);
