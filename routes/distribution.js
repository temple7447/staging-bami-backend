const express = require('express');
const { protect } = require('../middleware/auth');
const { validateObjectId, handleValidationErrors } = require('../middleware/validation');
const {
  getEstateWalletBalance,
  getEstateDistributionHistory,
  withdrawFamilySavings,
  withdrawFromAnyWallet,
  previewDistribution,
  getGrowthEngineDetails,
  getFulfillmentEngineDetails,
  getInnovationEngineDetails,
  getWalletSummary
} = require('../controllers/distributionController');

const router = express.Router({ mergeParams: true });

// Get overall wallet balance for estate
router.get('/:estateId/wallet/balance', protect, validateObjectId('estateId'), handleValidationErrors, getEstateWalletBalance);

// Get distribution history
router.get('/:estateId/wallet/history', protect, validateObjectId('estateId'), handleValidationErrors, getEstateDistributionHistory);

// Preview distribution calculation
router.get('/:estateId/wallet/preview', protect, handleValidationErrors, previewDistribution);

// Get wallet summary (totals)
router.get('/:estateId/wallet/summary', protect, validateObjectId('estateId'), handleValidationErrors, getWalletSummary);

// Get individual engine details
router.get('/:estateId/wallet/growth-engine', protect, validateObjectId('estateId'), handleValidationErrors, getGrowthEngineDetails);
router.get('/:estateId/wallet/fulfillment-engine', protect, validateObjectId('estateId'), handleValidationErrors, getFulfillmentEngineDetails);
router.get('/:estateId/wallet/innovation-engine', protect, validateObjectId('estateId'), handleValidationErrors, getInnovationEngineDetails);

// Withdraw from family savings (B-20%)
router.post('/:estateId/wallet/family-withdraw', protect, validateObjectId('estateId'), handleValidationErrors, withdrawFamilySavings);

// Withdraw from any wallet
router.post('/:estateId/wallet/withdraw', protect, validateObjectId('estateId'), handleValidationErrors, withdrawFromAnyWallet);

module.exports = router;
