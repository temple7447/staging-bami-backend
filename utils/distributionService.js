const WalletAccount = require('../models/WalletAccount');
const { logError, logInfo } = require('./logger');

/**
 * New Nested 50/30/20 Budget Allocation System
 * 
 * Each engine (Growth, Fulfillment, Innovation) receives a portion and splits it:
 * 
 * GROWTH ENGINE (50% of total):
 * - A-50%: Marketing & Sales/Affiliate Marketing = 25%
 * - A-30%: Operations (Fulfillment Engines) = 15%
 * - A-20%: Savings & Emergency (Innovation Engines) = 10%
 * 
 * FULFILLMENT ENGINES (30% of total):
 * - B-50%: Marketing & Sales/Affiliate Marketing = 15%
 * - B-30%: Operations (Fulfillment Engines) = 9%
 * - B-20%: Savings & Emergency (Family) = 6%
 * 
 * INNOVATION ENGINES (20% of total):
 * - C-50%: Marketing & Sales/Affiliate Marketing = 10%
 * - C-30%: Operations (Fulfillment Engines) = 6%
 * - C-20%: Savings & Emergency = 4%
 * 
 * Totals:
 * - Marketing (Growth Engine): 50%
 * - Operations: 30%
 * - Savings: 20%
 */
const DISTRIBUTION_PERCENTAGES = {
  growthEngine: {
    marketing: 0.50,  // 25% of total
    operations: 0.30, // 15% of total
    savings: 0.20     // 10% of total
  },
  fulfillmentEngine: {
    marketing: 0.50,  // 15% of total
    operations: 0.30, // 9% of total
    savings: 0.20     // 6% of total (FAMILY)
  },
  innovationEngine: {
    marketing: 0.50,  // 10% of total
    operations: 0.30, // 6% of total
    savings: 0.20     // 4% of total
  }
};

/**
 * Calculate distribution amounts
 */
const calculateDistribution = (amount) => {
  const growthTotal = amount * 0.50;
  const fulfillmentTotal = amount * 0.30;
  const innovationTotal = amount * 0.20;

  return {
    growthEngine: {
      marketing: growthTotal * DISTRIBUTION_PERCENTAGES.growthEngine.marketing,
      operations: growthTotal * DISTRIBUTION_PERCENTAGES.growthEngine.operations,
      savings: growthTotal * DISTRIBUTION_PERCENTAGES.growthEngine.savings,
      total: growthTotal
    },
    fulfillmentEngine: {
      marketing: fulfillmentTotal * DISTRIBUTION_PERCENTAGES.fulfillmentEngine.marketing,
      operations: fulfillmentTotal * DISTRIBUTION_PERCENTAGES.fulfillmentEngine.operations,
      savings: fulfillmentTotal * DISTRIBUTION_PERCENTAGES.fulfillmentEngine.savings,
      total: fulfillmentTotal
    },
    innovationEngine: {
      marketing: innovationTotal * DISTRIBUTION_PERCENTAGES.innovationEngine.marketing,
      operations: innovationTotal * DISTRIBUTION_PERCENTAGES.innovationEngine.operations,
      savings: innovationTotal * DISTRIBUTION_PERCENTAGES.innovationEngine.savings,
      total: innovationTotal
    },
    total: amount
  };
};

/**
 * Distribute payment amount across the 9 sub-wallets
 */
const distributePayment = async (estateId, amount, paymentId, paymentType = 'payment') => {
  try {
    let walletAccount = await WalletAccount.findOne({ estate: estateId });

    if (!walletAccount) {
      walletAccount = new WalletAccount({
        estate: estateId,
        growthEngineMarketingBalance: 0,
        growthEngineOperationsBalance: 0,
        growthEngineSavingsBalance: 0,
        fulfillmentEngineMarketingBalance: 0,
        fulfillmentEngineOperationsBalance: 0,
        fulfillmentEngineSavingsBalance: 0,
        innovationEngineMarketingBalance: 0,
        innovationEngineOperationsBalance: 0,
        innovationEngineSavingsBalance: 0,
        totalReceived: 0
      });
    }

    const distribution = walletAccount.distributeAmount(amount, paymentId, paymentType);
    await walletAccount.save();

    logInfo('Payment distributed successfully (Nested 50/30/20)', {
      estateId,
      amount,
      paymentType,
      distribution,
      breakdown: {
        growthEngine: '50%',
        fulfillmentEngine: '30%',
        innovationEngine: '20%'
      }
    });

    return {
      success: true,
      distribution,
      walletAccount: {
        growthEngine: {
          marketing: walletAccount.growthEngineMarketingBalance,
          operations: walletAccount.growthEngineOperationsBalance,
          savings: walletAccount.growthEngineSavingsBalance,
          total: walletAccount.growthEngineMarketingBalance + walletAccount.growthEngineOperationsBalance + walletAccount.growthEngineSavingsBalance
        },
        fulfillmentEngine: {
          marketing: walletAccount.fulfillmentEngineMarketingBalance,
          operations: walletAccount.fulfillmentEngineOperationsBalance,
          savings: walletAccount.fulfillmentEngineSavingsBalance,
          total: walletAccount.fulfillmentEngineMarketingBalance + walletAccount.fulfillmentEngineOperationsBalance + walletAccount.fulfillmentEngineSavingsBalance
        },
        innovationEngine: {
          marketing: walletAccount.innovationEngineMarketingBalance,
          operations: walletAccount.innovationEngineOperationsBalance,
          savings: walletAccount.innovationEngineSavingsBalance,
          total: walletAccount.innovationEngineMarketingBalance + walletAccount.innovationEngineOperationsBalance + walletAccount.innovationEngineSavingsBalance
        },
        total: walletAccount.totalBalance,
        totalMarketing: walletAccount.totalMarketing,
        totalOperations: walletAccount.totalOperations,
        totalSavings: walletAccount.totalSavings
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
        growthEngineMarketingBalance: 0,
        growthEngineOperationsBalance: 0,
        growthEngineSavingsBalance: 0,
        fulfillmentEngineMarketingBalance: 0,
        fulfillmentEngineOperationsBalance: 0,
        fulfillmentEngineSavingsBalance: 0,
        innovationEngineMarketingBalance: 0,
        innovationEngineOperationsBalance: 0,
        innovationEngineSavingsBalance: 0,
        totalReceived: 0
      });
      await walletAccount.save();
    }

    return {
      estateId,
      growthEngine: {
        marketing: {
          balance: walletAccount.growthEngineMarketingBalance,
          percentage: 25,
          label: 'A-50% Marketing & Sales'
        },
        operations: {
          balance: walletAccount.growthEngineOperationsBalance,
          percentage: 15,
          label: 'A-30% Operations'
        },
        savings: {
          balance: walletAccount.growthEngineSavingsBalance,
          percentage: 10,
          label: 'A-20% Savings & Emergency'
        },
        total: walletAccount.growthEngineMarketingBalance + walletAccount.growthEngineOperationsBalance + walletAccount.growthEngineSavingsBalance,
        percentage: 50
      },
      fulfillmentEngine: {
        marketing: {
          balance: walletAccount.fulfillmentEngineMarketingBalance,
          percentage: 15,
          label: 'B-50% Marketing & Sales'
        },
        operations: {
          balance: walletAccount.fulfillmentEngineOperationsBalance,
          percentage: 9,
          label: 'B-30% Operations'
        },
        savings: {
          balance: walletAccount.fulfillmentEngineSavingsBalance,
          percentage: 6,
          label: 'B-20% Family Savings'
        },
        total: walletAccount.fulfillmentEngineMarketingBalance + walletAccount.fulfillmentEngineOperationsBalance + walletAccount.fulfillmentEngineSavingsBalance,
        percentage: 30
      },
      innovationEngine: {
        marketing: {
          balance: walletAccount.innovationEngineMarketingBalance,
          percentage: 10,
          label: 'C-50% Marketing & Sales'
        },
        operations: {
          balance: walletAccount.innovationEngineOperationsBalance,
          percentage: 6,
          label: 'C-30% Operations'
        },
        savings: {
          balance: walletAccount.innovationEngineSavingsBalance,
          percentage: 4,
          label: 'C-20% Savings & Emergency'
        },
        total: walletAccount.innovationEngineMarketingBalance + walletAccount.innovationEngineOperationsBalance + walletAccount.innovationEngineSavingsBalance,
        percentage: 20
      },
      summary: {
        totalMarketing: walletAccount.totalMarketing,
        totalOperations: walletAccount.totalOperations,
        totalSavings: walletAccount.totalSavings,
        totalBalance: walletAccount.totalBalance,
        totalReceived: walletAccount.totalReceived
      },
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
        growthEngine: { marketing: [], operations: [], savings: [] },
        fulfillmentEngine: { marketing: [], operations: [], savings: [] },
        innovationEngine: { marketing: [], operations: [], savings: [] }
      };
    }

    return {
      growthEngine: {
        marketing: walletAccount.growthEngineMarketingDistributions.slice(-limit),
        operations: walletAccount.growthEngineOperationsDistributions.slice(-limit),
        savings: walletAccount.growthEngineSavingsDistributions.slice(-limit)
      },
      fulfillmentEngine: {
        marketing: walletAccount.fulfillmentEngineMarketingDistributions.slice(-limit),
        operations: walletAccount.fulfillmentEngineOperationsDistributions.slice(-limit),
        savings: walletAccount.fulfillmentEngineSavingsDistributions.slice(-limit)
      },
      innovationEngine: {
        marketing: walletAccount.innovationEngineMarketingDistributions.slice(-limit),
        operations: walletAccount.innovationEngineOperationsDistributions.slice(-limit),
        savings: walletAccount.innovationEngineSavingsDistributions.slice(-limit)
      }
    };
  } catch (error) {
    logError('distributionService.getDistributionHistory', error, { estateId });
    throw error;
  }
};

/**
 * Withdraw from family savings (B-20% wallet)
 */
const withdrawFromFamilySavings = async (estateId, amount, reason = 'withdrawal', userId) => {
  try {
    let walletAccount = await WalletAccount.findOne({ estate: estateId });

    if (!walletAccount) {
      throw new Error('Wallet account not found for this estate');
    }

    const result = walletAccount.withdrawFromFamilySavings(amount, reason);
    walletAccount.updatedBy = userId;
    await walletAccount.save();

    logInfo('Family savings withdrawal processed', {
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
    logError('distributionService.withdrawFromFamilySavings', error, { estateId, amount });
    throw error;
  }
};

/**
 * Withdraw from any wallet
 */
const withdrawFromWallet = async (estateId, walletType, amount, reason = 'withdrawal', userId) => {
  try {
    let walletAccount = await WalletAccount.findOne({ estate: estateId });

    if (!walletAccount) {
      throw new Error('Wallet account not found for this estate');
    }

    const result = walletAccount.withdrawFromWallet(walletType, amount, reason);
    walletAccount.updatedBy = userId;
    await walletAccount.save();

    logInfo('Wallet withdrawal processed', {
      estateId,
      walletType,
      amount,
      reason,
      newBalance: result.newBalance
    });

    return {
      success: true,
      ...result
    };
  } catch (error) {
    logError('distributionService.withdrawFromWallet', error, { estateId, walletType, amount });
    throw error;
  }
};

module.exports = {
  distributePayment,
  calculateDistribution,
  getWalletBalance,
  getDistributionHistory,
  withdrawFromFamilySavings,
  withdrawFromWallet,
  DISTRIBUTION_PERCENTAGES
};
