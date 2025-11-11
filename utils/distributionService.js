const WalletAccount = require('../models/WalletAccount');
const { logError, logInfo } = require('./logger');

/**
 * Global distribution percentages for ALL payments/deposits
 * - Marketing & Investment: 50%
 * - Owner Withdraw: 30%
 * - Operations & Maintenance: 20%
 */
const DISTRIBUTION_PERCENTAGES = {
  marketing: 0.50,
  owner: 0.30,
  operations: 0.20
};

/**
 * Calculate distribution amounts
 */
const calculateDistribution = (amount) => {
  return {
    marketing: amount * DISTRIBUTION_PERCENTAGES.marketing,
    owner: amount * DISTRIBUTION_PERCENTAGES.owner,
    operations: amount * DISTRIBUTION_PERCENTAGES.operations
  };
};

/**
 * Distribute payment amount across the three accounts
 * - Marketing & Investment: 50%
 * - Owner Withdraw: 30%
 * - Operations & Maintenance: 20%
 * 
 * This applies to ALL deposits/payments globally
 */
const distributePayment = async (estateId, amount, paymentId, paymentType = 'payment') => {
  try {
    // Get or create wallet account for estate
    let walletAccount = await WalletAccount.findOne({ estate: estateId });

    if (!walletAccount) {
      walletAccount = new WalletAccount({
        estate: estateId,
        marketingBalance: 0,
        ownerBalance: 0,
        operationsBalance: 0,
        totalReceived: 0
      });
    }

    // Distribute the amount
    const distribution = walletAccount.distributeAmount(amount, paymentId, paymentType);
    await walletAccount.save();

    logInfo('Payment distributed successfully (Global 50/30/20)', {
      estateId,
      amount,
      paymentType,
      distribution,
      breakdown: {
        marketing: `${DISTRIBUTION_PERCENTAGES.marketing * 100}%`,
        owner: `${DISTRIBUTION_PERCENTAGES.owner * 100}%`,
        operations: `${DISTRIBUTION_PERCENTAGES.operations * 100}%`
      }
    });

    return {
      success: true,
      distribution,
      walletAccount: {
        marketing: walletAccount.marketingBalance,
        owner: walletAccount.ownerBalance,
        operations: walletAccount.operationsBalance,
        total: walletAccount.totalBalance
      }
    };
  } catch (error) {
    logError('distributionService.distributePayment', error, { estateId, amount, paymentId });
    throw error;
  }
};

/**
 * Get wallet account balance for an estate
 */
const getWalletBalance = async (estateId) => {
  try {
    let walletAccount = await WalletAccount.findOne({ estate: estateId });

    if (!walletAccount) {
      walletAccount = new WalletAccount({
        estate: estateId,
        marketingBalance: 0,
        ownerBalance: 0,
        operationsBalance: 0,
        totalReceived: 0
      });
      await walletAccount.save();
    }

    return {
      estateId,
      marketing: {
        balance: walletAccount.marketingBalance,
        percentage: 50
      },
      owner: {
        balance: walletAccount.ownerBalance,
        percentage: 30
      },
      operations: {
        balance: walletAccount.operationsBalance,
        percentage: 20
      },
      totalReceived: walletAccount.totalReceived,
      totalBalance: walletAccount.totalBalance,
      lastUpdated: walletAccount.lastUpdated
    };
  } catch (error) {
    logError('distributionService.getWalletBalance', error, { estateId });
    throw error;
  }
};

/**
 * Get distribution history for an estate
 */
const getDistributionHistory = async (estateId, limit = 100) => {
  try {
    const walletAccount = await WalletAccount.findOne({ estate: estateId });

    if (!walletAccount) {
      return {
        marketing: [],
        owner: [],
        operations: []
      };
    }

    return {
      marketing: walletAccount.marketingDistributions.slice(-limit),
      owner: walletAccount.ownerDistributions.slice(-limit),
      operations: walletAccount.operationsDistributions.slice(-limit)
    };
  } catch (error) {
    logError('distributionService.getDistributionHistory', error, { estateId });
    throw error;
  }
};

/**
 * Withdraw from owner account
 */
const withdrawFromOwner = async (estateId, amount, reason = 'withdrawal', userId) => {
  try {
    let walletAccount = await WalletAccount.findOne({ estate: estateId });

    if (!walletAccount) {
      throw new Error('Wallet account not found for this estate');
    }

    const result = walletAccount.withdrawFromOwner(amount, reason);
    walletAccount.updatedBy = userId;
    await walletAccount.save();

    logInfo('Owner withdrawal processed', {
      estateId,
      amount,
      reason,
      newBalance: result.newBalance
    });

    return {
      success: true,
      ...result
    };
  } catch (error) {
    logError('distributionService.withdrawFromOwner', error, { estateId, amount });
    throw error;
  }
};

module.exports = {
  distributePayment,
  calculateDistribution,
  getWalletBalance,
  getDistributionHistory,
  withdrawFromOwner,
  DISTRIBUTION_PERCENTAGES
};
