const mongoose = require('mongoose');

const WalletAccountSchema = new mongoose.Schema({
  estate: {
    type: mongoose.Schema.ObjectId,
    ref: 'Estate',
    required: true
  },

  // =====================================================
  // GROWTH ENGINE (50% of total) - Business Asset Operations
  // =====================================================
  
  // A-50%: Marketing & Sales/Affiliate Marketing (Growth Engine) - 25% of total
  growthEngineMarketingBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  growthEngineMarketingDistributions: [
    {
      paymentId: mongoose.Schema.ObjectId,
      amount: Number,
      description: String,
      createdAt: { type: Date, default: Date.now }
    }
  ],

  // A-30%: Operations (Fulfillment Engines) - 15% of total
  growthEngineOperationsBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  growthEngineOperationsDistributions: [
    {
      paymentId: mongoose.Schema.ObjectId,
      amount: Number,
      description: String,
      createdAt: { type: Date, default: Date.now }
    }
  ],

  // A-20%: Savings & Emergency (Innovation Engines) - 10% of total
  growthEngineSavingsBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  growthEngineSavingsDistributions: [
    {
      paymentId: mongoose.Schema.ObjectId,
      amount: Number,
      description: String,
      createdAt: { type: Date, default: Date.now }
    }
  ],

  // =====================================================
  // FULFILLMENT ENGINES (30% of total) - Owners Asset Operations
  // =====================================================

  // B-50%: Marketing & Sales/Affiliate Marketing (Growth Engine) - 15% of total
  fulfillmentEngineMarketingBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  fulfillmentEngineMarketingDistributions: [
    {
      paymentId: mongoose.Schema.ObjectId,
      amount: Number,
      description: String,
      createdAt: { type: Date, default: Date.now }
    }
  ],

  // B-30%: Operations (Fulfillment Engines) - 9% of total
  fulfillmentEngineOperationsBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  fulfillmentEngineOperationsDistributions: [
    {
      paymentId: mongoose.Schema.ObjectId,
      amount: Number,
      description: String,
      createdAt: { type: Date, default: Date.now }
    }
  ],

  // B-20%: Savings & Emergency (Innovation Engines) - Family wallet - 6% of total
  fulfillmentEngineSavingsBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  fulfillmentEngineSavingsDistributions: [
    {
      paymentId: mongoose.Schema.ObjectId,
      amount: Number,
      description: String,
      createdAt: { type: Date, default: Date.now }
    }
  ],

  // =====================================================
  // INNOVATION ENGINES (20% of total) - Savings & Emergency
  // =====================================================

  // C-50%: Marketing & Sales/Affiliate Marketing (Growth Engine) - 10% of total
  innovationEngineMarketingBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  innovationEngineMarketingDistributions: [
    {
      paymentId: mongoose.Schema.ObjectId,
      amount: Number,
      description: String,
      createdAt: { type: Date, default: Date.now }
    }
  ],

  // C-30%: Operations (Fulfillment Engines) - 6% of total
  innovationEngineOperationsBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  innovationEngineOperationsDistributions: [
    {
      paymentId: mongoose.Schema.ObjectId,
      amount: Number,
      description: String,
      createdAt: { type: Date, default: Date.now }
    }
  ],

  // C-20%: Savings & Emergency (Innovation Engines) - 4% of total
  innovationEngineSavingsBalance: {
    type: Number,
    default: 0,
    min: 0
  },
  innovationEngineSavingsDistributions: [
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
  return (
    this.growthEngineMarketingBalance +
    this.growthEngineOperationsBalance +
    this.growthEngineSavingsBalance +
    this.fulfillmentEngineMarketingBalance +
    this.fulfillmentEngineOperationsBalance +
    this.fulfillmentEngineSavingsBalance +
    this.innovationEngineMarketingBalance +
    this.innovationEngineOperationsBalance +
    this.innovationEngineSavingsBalance
  );
});

// Virtual for Marketing total (50%)
WalletAccountSchema.virtual('totalMarketing').get(function() {
  return (
    this.growthEngineMarketingBalance +
    this.fulfillmentEngineMarketingBalance +
    this.innovationEngineMarketingBalance
  );
});

// Virtual for Operations total (30%)
WalletAccountSchema.virtual('totalOperations').get(function() {
  return (
    this.growthEngineOperationsBalance +
    this.fulfillmentEngineOperationsBalance +
    this.innovationEngineOperationsBalance
  );
});

// Virtual for Savings total (20%)
WalletAccountSchema.virtual('totalSavings').get(function() {
  return (
    this.growthEngineSavingsBalance +
    this.fulfillmentEngineSavingsBalance +
    this.innovationEngineSavingsBalance
  );
});

// Ensure virtuals are included in JSON
WalletAccountSchema.set('toJSON', { virtuals: true });
WalletAccountSchema.set('toObject', { virtuals: true });

// Method to distribute funds using the nested 50/30/20 system
WalletAccountSchema.methods.distributeAmount = function(amount, paymentId, paymentType = 'payment') {
  // GROWTH ENGINE (50% of total = 50% of amount)
  const growthEngineTotal = amount * 0.50;
  const a50_marketing = growthEngineTotal * 0.50; // 25% of total
  const a30_operations = growthEngineTotal * 0.30; // 15% of total
  const a20_savings = growthEngineTotal * 0.20;    // 10% of total

  // FULFILLMENT ENGINES (30% of total = 30% of amount)
  const fulfillmentEngineTotal = amount * 0.30;
  const b50_marketing = fulfillmentEngineTotal * 0.50; // 15% of total
  const b30_operations = fulfillmentEngineTotal * 0.30; // 9% of total
  const b20_savings = fulfillmentEngineTotal * 0.20;    // 6% of total (FAMILY)

  // INNOVATION ENGINES (20% of total = 20% of amount)
  const innovationEngineTotal = amount * 0.20;
  const c50_marketing = innovationEngineTotal * 0.50; // 10% of total
  const c30_operations = innovationEngineTotal * 0.30; // 6% of total
  const c20_savings = innovationEngineTotal * 0.20;   // 4% of total

  // Apply to Growth Engine wallets
  this.growthEngineMarketingBalance += a50_marketing;
  this.growthEngineMarketingDistributions.push({
    paymentId,
    amount: a50_marketing,
    description: `${paymentType} - Growth Engine Marketing (A-50% = 25%)`,
    createdAt: new Date()
  });

  this.growthEngineOperationsBalance += a30_operations;
  this.growthEngineOperationsDistributions.push({
    paymentId,
    amount: a30_operations,
    description: `${paymentType} - Growth Engine Operations (A-30% = 15%)`,
    createdAt: new Date()
  });

  this.growthEngineSavingsBalance += a20_savings;
  this.growthEngineSavingsDistributions.push({
    paymentId,
    amount: a20_savings,
    description: `${paymentType} - Growth Engine Savings (A-20% = 10%)`,
    createdAt: new Date()
  });

  // Apply to Fulfillment Engine wallets
  this.fulfillmentEngineMarketingBalance += b50_marketing;
  this.fulfillmentEngineMarketingDistributions.push({
    paymentId,
    amount: b50_marketing,
    description: `${paymentType} - Fulfillment Engine Marketing (B-50% = 15%)`,
    createdAt: new Date()
  });

  this.fulfillmentEngineOperationsBalance += b30_operations;
  this.fulfillmentEngineOperationsDistributions.push({
    paymentId,
    amount: b30_operations,
    description: `${paymentType} - Fulfillment Engine Operations (B-30% = 9%)`,
    createdAt: new Date()
  });

  this.fulfillmentEngineSavingsBalance += b20_savings;
  this.fulfillmentEngineSavingsDistributions.push({
    paymentId,
    amount: b20_savings,
    description: `${paymentType} - Fulfillment Engine Savings/Family (B-20% = 6%)`,
    createdAt: new Date()
  });

  // Apply to Innovation Engine wallets
  this.innovationEngineMarketingBalance += c50_marketing;
  this.innovationEngineMarketingDistributions.push({
    paymentId,
    amount: c50_marketing,
    description: `${paymentType} - Innovation Engine Marketing (C-50% = 10%)`,
    createdAt: new Date()
  });

  this.innovationEngineOperationsBalance += c30_operations;
  this.innovationEngineOperationsDistributions.push({
    paymentId,
    amount: c30_operations,
    description: `${paymentType} - Innovation Engine Operations (C-30% = 6%)`,
    createdAt: new Date()
  });

  this.innovationEngineSavingsBalance += c20_savings;
  this.innovationEngineSavingsDistributions.push({
    paymentId,
    amount: c20_savings,
    description: `${paymentType} - Innovation Engine Savings (C-20% = 4%)`,
    createdAt: new Date()
  });

  this.totalReceived += amount;
  this.lastUpdated = new Date();

  return {
    growthEngine: {
      marketing: a50_marketing,
      operations: a30_operations,
      savings: a20_savings,
      total: growthEngineTotal
    },
    fulfillmentEngine: {
      marketing: b50_marketing,
      operations: b30_operations,
      savings: b20_savings,
      total: fulfillmentEngineTotal
    },
    innovationEngine: {
      marketing: c50_marketing,
      operations: c30_operations,
      savings: c20_savings,
      total: innovationEngineTotal
    },
    total: amount
  };
};

// Method to withdraw from family savings (B-20% wallet)
WalletAccountSchema.methods.withdrawFromFamilySavings = function(amount, reason = 'withdrawal') {
  if (this.fulfillmentEngineSavingsBalance < amount) {
    throw new Error('Insufficient family savings balance');
  }

  this.fulfillmentEngineSavingsBalance -= amount;
  this.fulfillmentEngineSavingsDistributions.push({
    amount: -amount,
    description: `Family savings withdrawal: ${reason}`,
    createdAt: new Date()
  });

  this.lastUpdated = new Date();

  return {
    newBalance: this.fulfillmentEngineSavingsBalance,
    withdrawnAmount: amount
  };
};

// Method to withdraw from any wallet
WalletAccountSchema.methods.withdrawFromWallet = function(walletType, amount, reason = 'withdrawal') {
  const walletBalances = {
    growthEngineMarketing: 'growthEngineMarketingBalance',
    growthEngineOperations: 'growthEngineOperationsBalance',
    growthEngineSavings: 'growthEngineSavingsBalance',
    fulfillmentEngineMarketing: 'fulfillmentEngineMarketingBalance',
    fulfillmentEngineOperations: 'fulfillmentEngineOperationsBalance',
    fulfillmentEngineSavings: 'fulfillmentEngineSavingsBalance',
    innovationEngineMarketing: 'innovationEngineMarketingBalance',
    innovationEngineOperations: 'innovationEngineOperationsBalance',
    innovationEngineSavings: 'innovationEngineSavingsBalance'
  };

  const balanceField = walletBalances[walletType];
  if (!balanceField) {
    throw new Error('Invalid wallet type');
  }

  if (this[balanceField] < amount) {
    throw new Error(`Insufficient balance in ${walletType}`);
  }

  this[balanceField] -= amount;
  this.lastUpdated = new Date();

  return {
    newBalance: this[balanceField],
    withdrawnAmount: amount,
    walletType
  };
};

module.exports = mongoose.model('WalletAccount', WalletAccountSchema);
