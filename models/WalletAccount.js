const mongoose = require('mongoose');

const WalletAccountSchema = new mongoose.Schema({
  estate: {
    type: mongoose.Schema.ObjectId,
    ref: 'Estate',
    required: true
  },
  // Marketing and Investment Account - 50%
  marketingBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  marketingDistributions: [
    {
      paymentId: mongoose.Schema.ObjectId,
      amount: Number,
      description: String,
      createdAt: { type: Date, default: Date.now }
    }
  ],

  // Owner Withdraw Account - 30%
  ownerBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  ownerDistributions: [
    {
      paymentId: mongoose.Schema.ObjectId,
      amount: Number,
      description: String,
      createdAt: { type: Date, default: Date.now }
    }
  ],

  // Operations & Maintenance Account - 20%
  operationsBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  operationsDistributions: [
    {
      paymentId: mongoose.Schema.ObjectId,
      amount: Number,
      description: String,
      createdAt: { type: Date, default: Date.now }
    }
  ],

  // Total received
  totalReceived: {
    type: Number,
    default: 0
  },

  // Audit trail
  lastUpdated: {
    type: Date,
    default: Date.now
  },
  updatedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  }
}, {
  timestamps: true
});

// Index for quick lookups
WalletAccountSchema.index({ estate: 1 });

// Virtual for total balance
WalletAccountSchema.virtual('totalBalance').get(function() {
  return this.marketingBalance + this.ownerBalance + this.operationsBalance;
});

// Method to distribute funds to the three accounts
WalletAccountSchema.methods.distributeAmount = function(amount, paymentId, paymentType = 'payment') {
  const marketingAmount = amount * 0.50;
  const ownerAmount = amount * 0.30;
  const operationsAmount = amount * 0.20;

  this.marketingBalance += marketingAmount;
  this.marketingDistributions.push({
    paymentId,
    amount: marketingAmount,
    description: `${paymentType} distribution (50%)`,
    createdAt: new Date()
  });

  this.ownerBalance += ownerAmount;
  this.ownerDistributions.push({
    paymentId,
    amount: ownerAmount,
    description: `${paymentType} distribution (30%)`,
    createdAt: new Date()
  });

  this.operationsBalance += operationsAmount;
  this.operationsDistributions.push({
    paymentId,
    amount: operationsAmount,
    description: `${paymentType} distribution (20%)`,
    createdAt: new Date()
  });

  this.totalReceived += amount;
  this.lastUpdated = new Date();

  return {
    marketing: marketingAmount,
    owner: ownerAmount,
    operations: operationsAmount,
    total: amount
  };
};

// Method to withdraw from owner account
WalletAccountSchema.methods.withdrawFromOwner = function(amount, reason = 'withdrawal') {
  if (this.ownerBalance < amount) {
    throw new Error('Insufficient owner account balance');
  }

  this.ownerBalance -= amount;
  this.ownerDistributions.push({
    amount: -amount,
    description: `Owner withdrawal: ${reason}`,
    createdAt: new Date()
  });

  this.lastUpdated = new Date();

  return {
    newBalance: this.ownerBalance,
    withdrawnAmount: amount
  };
};

module.exports = mongoose.model('WalletAccount', WalletAccountSchema);
