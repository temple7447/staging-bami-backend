const express = require('express');
const { protect } = require('../middleware/auth');
const { validateObjectId, handleValidationErrors } = require('../middleware/validation');
const {
  getEstateWalletBalance,
  getEstateDistributionHistory,
  withdrawOwnerFunds,
  getMarketingAccountDetails,
  getOwnerAccountDetails,
  getOperationsAccountDetails
} = require('../controllers/distributionController');

const router = express.Router({ mergeParams: true });

// Get overall wallet balance for estate
router.get('/:estateId/wallet/balance', protect, validateObjectId('estateId'), handleValidationErrors, getEstateWalletBalance);

// Get distribution history
router.get('/:estateId/wallet/history', protect, validateObjectId('estateId'), handleValidationErrors, getEstateDistributionHistory);

// Get individual account details
router.get('/:estateId/wallet/marketing', protect, validateObjectId('estateId'), handleValidationErrors, getMarketingAccountDetails);
router.get('/:estateId/wallet/owner', protect, validateObjectId('estateId'), handleValidationErrors, getOwnerAccountDetails);
router.get('/:estateId/wallet/operations', protect, validateObjectId('estateId'), handleValidationErrors, getOperationsAccountDetails);

// Withdraw from owner account
router.post('/:estateId/wallet/withdraw', protect, validateObjectId('estateId'), handleValidationErrors, withdrawOwnerFunds);

module.exports = router;
