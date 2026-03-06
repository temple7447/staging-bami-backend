const { getWalletBalance, getDistributionHistory, withdrawFromFamilySavings, withdrawFromWallet, calculateDistribution } = require('../utils/distributionService');
const { logError, logInfo } = require('../utils/logger');
const WalletAccount = require('../models/WalletAccount');

/**
 * Get global wallet summary across all estates (9 wallets aggregated)
 */
const getGlobalWalletSummary = async (req, res) => {
  try {
    logInfo('Fetching global wallet summary');

    const result = await WalletAccount.aggregate([
      {
        $group: {
          _id: null,
          growthEngineMarketingBalance: { $sum: '$growthEngineMarketingBalance' },
          growthEngineOperationsBalance: { $sum: '$growthEngineOperationsBalance' },
          growthEngineSavingsBalance: { $sum: '$growthEngineSavingsBalance' },
          fulfillmentEngineMarketingBalance: { $sum: '$fulfillmentEngineMarketingBalance' },
          fulfillmentEngineOperationsBalance: { $sum: '$fulfillmentEngineOperationsBalance' },
          fulfillmentEngineSavingsBalance: { $sum: '$fulfillmentEngineSavingsBalance' },
          innovationEngineMarketingBalance: { $sum: '$innovationEngineMarketingBalance' },
          innovationEngineOperationsBalance: { $sum: '$innovationEngineOperationsBalance' },
          innovationEngineSavingsBalance: { $sum: '$innovationEngineSavingsBalance' },
          totalReceived: { $sum: '$totalReceived' }
        }
      }
    ]);

    const data = result[0] || {
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
    };

    const totalBalance = 
      data.growthEngineMarketingBalance +
      data.growthEngineOperationsBalance +
      data.growthEngineSavingsBalance +
      data.fulfillmentEngineMarketingBalance +
      data.fulfillmentEngineOperationsBalance +
      data.fulfillmentEngineSavingsBalance +
      data.innovationEngineMarketingBalance +
      data.innovationEngineOperationsBalance +
      data.innovationEngineSavingsBalance;

    res.status(200).json({
      success: true,
      data: {
        growthEngine: {
          marketing: {
            name: 'Growth Engine Marketing',
            balance: data.growthEngineMarketingBalance,
            percentage: 25
          },
          operations: {
            name: 'Growth Engine Operations',
            balance: data.growthEngineOperationsBalance,
            percentage: 15
          },
          savings: {
            name: 'Growth Engine Savings',
            balance: data.growthEngineSavingsBalance,
            percentage: 10
          },
          total: data.growthEngineMarketingBalance + data.growthEngineOperationsBalance + data.growthEngineSavingsBalance,
          percentage: 50
        },
        fulfillmentEngine: {
          marketing: {
            name: 'Fulfillment Engine Marketing',
            balance: data.fulfillmentEngineMarketingBalance,
            percentage: 15
          },
          operations: {
            name: 'Fulfillment Engine Operations',
            balance: data.fulfillmentEngineOperationsBalance,
            percentage: 9
          },
          savings: {
            name: 'Fulfillment Engine Family Savings',
            balance: data.fulfillmentEngineSavingsBalance,
            percentage: 6
          },
          total: data.fulfillmentEngineMarketingBalance + data.fulfillmentEngineOperationsBalance + data.fulfillmentEngineSavingsBalance,
          percentage: 30
        },
        innovationEngine: {
          marketing: {
            name: 'Innovation Engine Marketing',
            balance: data.innovationEngineMarketingBalance,
            percentage: 10
          },
          operations: {
            name: 'Innovation Engine Operations',
            balance: data.innovationEngineOperationsBalance,
            percentage: 6
          },
          savings: {
            name: 'Innovation Engine Savings',
            balance: data.innovationEngineSavingsBalance,
            percentage: 4
          },
          total: data.innovationEngineMarketingBalance + data.innovationEngineOperationsBalance + data.innovationEngineSavingsBalance,
          percentage: 20
        },
        summary: {
          totalBalance,
          totalReceived: data.totalReceived,
          totalMarketing: data.growthEngineMarketingBalance + data.fulfillmentEngineMarketingBalance + data.innovationEngineMarketingBalance,
          totalOperations: data.growthEngineOperationsBalance + data.fulfillmentEngineOperationsBalance + data.innovationEngineOperationsBalance,
          totalSavings: data.growthEngineSavingsBalance + data.fulfillmentEngineSavingsBalance + data.innovationEngineSavingsBalance
        }
      }
    });
  } catch (error) {
    logError('GET /api/wallets/global-summary', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching global wallet summary',
      error: error.message
    });
  }
};

/**
 * Get wallet account balances for an estate
 */
const getEstateWalletBalance = async (req, res) => {
  try {
    const { estateId } = req.params;

    logInfo('Fetching wallet balance', { estateId });

    const balance = await getWalletBalance(estateId);

    res.status(200).json({
      success: true,
      data: balance
    });
  } catch (error) {
    logError('GET /api/estates/:estateId/wallet/balance', error, { estateId: req.params.estateId });
    res.status(500).json({
      success: false,
      message: 'Error fetching wallet balance',
      error: error.message
    });
  }
};

/**
 * Get distribution history for all wallets
 */
const getEstateDistributionHistory = async (req, res) => {
  try {
    const { estateId } = req.params;
    const { limit = 100 } = req.query;

    logInfo('Fetching distribution history', { estateId, limit });

    const history = await getDistributionHistory(estateId, parseInt(limit));

    res.status(200).json({
      success: true,
      data: history
    });
  } catch (error) {
    logError('GET /api/estates/:estateId/wallet/history', error, { estateId: req.params.estateId });
    res.status(500).json({
      success: false,
      message: 'Error fetching distribution history',
      error: error.message
    });
  }
};

/**
 * Withdraw from family savings (B-20% wallet)
 */
const withdrawFamilySavings = async (req, res) => {
  try {
    const { estateId } = req.params;
    const { amount, reason } = req.body;
    const userId = req.user?._id;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    logInfo('Processing family savings withdrawal', { estateId, amount, reason });

    const result = await withdrawFromFamilySavings(estateId, amount, reason, userId);

    res.status(200).json({
      success: true,
      message: 'Family savings withdrawal processed successfully',
      data: result
    });
  } catch (error) {
    logError('POST /api/estates/:estateId/wallet/family-withdraw', error, {
      estateId: req.params.estateId,
      amount: req.body?.amount
    });

    if (error.message.includes('Insufficient')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error processing withdrawal',
      error: error.message
    });
  }
};

/**
 * Withdraw from any wallet
 */
const withdrawFromAnyWallet = async (req, res) => {
  try {
    const { estateId } = req.params;
    const { walletType, amount, reason } = req.body;
    const userId = req.user?._id;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    if (!walletType) {
      return res.status(400).json({
        success: false,
        message: 'Wallet type is required'
      });
    }

    const validWalletTypes = [
      'growthEngineMarketing',
      'growthEngineOperations',
      'growthEngineSavings',
      'fulfillmentEngineMarketing',
      'fulfillmentEngineOperations',
      'fulfillmentEngineSavings',
      'innovationEngineMarketing',
      'innovationEngineOperations',
      'innovationEngineSavings'
    ];

    if (!validWalletTypes.includes(walletType)) {
      return res.status(400).json({
        success: false,
        message: `Invalid wallet type. Valid types: ${validWalletTypes.join(', ')}`
      });
    }

    logInfo('Processing wallet withdrawal', { estateId, walletType, amount, reason });

    const result = await withdrawFromWallet(estateId, walletType, amount, reason, userId);

    res.status(200).json({
      success: true,
      message: 'Wallet withdrawal processed successfully',
      data: result
    });
  } catch (error) {
    logError('POST /api/estates/:estateId/wallet/withdraw', error, {
      estateId: req.params.estateId,
      walletType: req.body?.walletType,
      amount: req.body?.amount
    });

    if (error.message.includes('Insufficient') || error.message.includes('Invalid')) {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Error processing withdrawal',
      error: error.message
    });
  }
};

/**
 * Calculate distribution for a given amount (preview)
 */
const previewDistribution = async (req, res) => {
  try {
    const { amount } = req.query;

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Amount must be greater than 0'
      });
    }

    const distribution = calculateDistribution(parseFloat(amount));

    res.status(200).json({
      success: true,
      data: {
        amount: parseFloat(amount),
        distribution
      }
    });
  } catch (error) {
    logError('GET /api/estates/:estateId/wallet/preview', error);
    res.status(500).json({
      success: false,
      message: 'Error calculating distribution',
      error: error.message
    });
  }
};

/**
 * Get Growth Engine wallet details
 */
const getGrowthEngineDetails = async (req, res) => {
  try {
    const { estateId } = req.params;
    const balance = await getWalletBalance(estateId);

    res.status(200).json({
      success: true,
      data: {
        engine: 'Growth Engine',
        description: 'Business Asset Operations (50%)',
        wallets: balance.growthEngine,
        totalPercentage: 50
      }
    });
  } catch (error) {
    logError('GET /api/estates/:estateId/wallet/growth-engine', error, { estateId: req.params.estateId });
    res.status(500).json({
      success: false,
      message: 'Error fetching Growth Engine details',
      error: error.message
    });
  }
};

/**
 * Get Fulfillment Engine wallet details
 */
const getFulfillmentEngineDetails = async (req, res) => {
  try {
    const { estateId } = req.params;
    const balance = await getWalletBalance(estateId);

    res.status(200).json({
      success: true,
      data: {
        engine: 'Fulfillment Engines',
        description: 'Owners Asset Operations (30%)',
        wallets: balance.fulfillmentEngine,
        totalPercentage: 30
      }
    });
  } catch (error) {
    logError('GET /api/estates/:estateId/wallet/fulfillment-engine', error, { estateId: req.params.estateId });
    res.status(500).json({
      success: false,
      message: 'Error fetching Fulfillment Engine details',
      error: error.message
    });
  }
};

/**
 * Get Innovation Engine wallet details
 */
const getInnovationEngineDetails = async (req, res) => {
  try {
    const { estateId } = req.params;
    const balance = await getWalletBalance(estateId);

    res.status(200).json({
      success: true,
      data: {
        engine: 'Innovation Engines',
        description: 'Savings & Emergency Asset Operations (20%)',
        wallets: balance.innovationEngine,
        totalPercentage: 20
      }
    });
  } catch (error) {
    logError('GET /api/estates/:estateId/wallet/innovation-engine', error, { estateId: req.params.estateId });
    res.status(500).json({
      success: false,
      message: 'Error fetching Innovation Engine details',
      error: error.message
    });
  }
};

module.exports = {
  getGlobalWalletSummary,
  getEstateWalletBalance,
  getEstateDistributionHistory,
  withdrawFamilySavings,
  withdrawFromAnyWallet,
  previewDistribution,
  getGrowthEngineDetails,
  getFulfillmentEngineDetails,
  getInnovationEngineDetails
};
