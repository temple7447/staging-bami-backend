const { getWalletBalance, getDistributionHistory, withdrawFromOwner } = require('../utils/distributionService');
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
 * Get distribution history for all three accounts
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
 * Withdraw from owner account
 */
const withdrawOwnerFunds = async (req, res) => {
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

    logInfo('Processing owner withdrawal', { estateId, amount, reason });

    const result = await withdrawFromOwner(estateId, amount, reason, userId);

    res.status(200).json({
      success: true,
      message: 'Owner withdrawal processed successfully',
      data: result
    });
  } catch (error) {
    logError('POST /api/estates/:estateId/wallet/withdraw', error, {
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
 * Get marketing account details
 */
const getMarketingAccountDetails = async (req, res) => {
  try {
    const { estateId } = req.params;
    const balance = await getWalletBalance(estateId);

    res.status(200).json({
      success: true,
      data: {
        account: 'Marketing & Investment',
        percentage: 50,
        balance: balance.marketing.balance,
        totalReceived: balance.totalReceived,
        lastUpdated: balance.lastUpdated
      }
    });
  } catch (error) {
    logError('GET /api/estates/:estateId/wallet/marketing', error, { estateId: req.params.estateId });
    res.status(500).json({
      success: false,
      message: 'Error fetching marketing account details',
      error: error.message
    });
  }
};

/**
 * Get owner account details
 */
const getOwnerAccountDetails = async (req, res) => {
  try {
    const { estateId } = req.params;
    const balance = await getWalletBalance(estateId);

    res.status(200).json({
      success: true,
      data: {
        account: 'Owner Withdraw',
        percentage: 30,
        balance: balance.owner.balance,
        totalReceived: balance.totalReceived,
        lastUpdated: balance.lastUpdated
      }
    });
  } catch (error) {
    logError('GET /api/estates/:estateId/wallet/owner', error, { estateId: req.params.estateId });
    res.status(500).json({
      success: false,
      message: 'Error fetching owner account details',
      error: error.message
    });
  }
};

/**
 * Get operations account details
 */
const getOperationsAccountDetails = async (req, res) => {
  try {
    const { estateId } = req.params;
    const balance = await getWalletBalance(estateId);

    res.status(200).json({
      success: true,
      data: {
        account: 'Operations & Maintenance',
        percentage: 20,
        balance: balance.operations.balance,
        totalReceived: balance.totalReceived,
        lastUpdated: balance.lastUpdated
      }
    });
  } catch (error) {
    logError('GET /api/estates/:estateId/wallet/operations', error, { estateId: req.params.estateId });
    res.status(500).json({
      success: false,
      message: 'Error fetching operations account details',
      error: error.message
    });
  }
};

module.exports = {
  getEstateWalletBalance,
  getEstateDistributionHistory,
  withdrawOwnerFunds,
  getMarketingAccountDetails,
  getOwnerAccountDetails,
  getOperationsAccountDetails
};
