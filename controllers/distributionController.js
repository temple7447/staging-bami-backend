const { getWalletBalance, getDistributionHistory, withdrawFromFamilySavings, withdrawFromWallet, calculateDistribution } = require('../utils/distributionService');
const { logError, logInfo } = require('../utils/logger');

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

/**
 * Get total summary (Marketing, Operations, Savings)
 */
const getWalletSummary = async (req, res) => {
  try {
    const { estateId } = req.params;
    const balance = await getWalletBalance(estateId);

    res.status(200).json({
      success: true,
      data: {
        totalBalance: balance.summary.totalBalance,
        totalReceived: balance.summary.totalReceived,
        marketing: {
          name: 'Marketing & Sales/Affiliate Marketing',
          balance: balance.summary.totalMarketing,
          percentage: 50
        },
        operations: {
          name: 'Operations',
          balance: balance.summary.totalOperations,
          percentage: 30
        },
        savings: {
          name: 'Savings & Emergency',
          balance: balance.summary.totalSavings,
          percentage: 20,
          familyPortion: balance.fulfillmentEngine.savings.balance
        },
        lastUpdated: balance.lastUpdated
      }
    });
  } catch (error) {
    logError('GET /api/estates/:estateId/wallet/summary', error, { estateId: req.params.estateId });
    res.status(500).json({
      success: false,
      message: 'Error fetching wallet summary',
      error: error.message
    });
  }
};

module.exports = {
  getEstateWalletBalance,
  getEstateDistributionHistory,
  withdrawFamilySavings,
  withdrawFromAnyWallet,
  previewDistribution,
  getGrowthEngineDetails,
  getFulfillmentEngineDetails,
  getInnovationEngineDetails,
  getWalletSummary
};
