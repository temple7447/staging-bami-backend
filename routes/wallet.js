const express = require('express');
const { protect } = require('../middleware/auth');
const { body } = require('express-validator');
const {
  getWallet,
  createWallet,
  addFunds,
  deductFunds,
  getTransactionHistory
} = require('../controllers/walletController');
const {
  initializeDeposit,
  verifyDeposit
} = require('../controllers/paystackController');

const router = express.Router();

// Get current user's wallet
router.get('/', protect, getWallet);

// Get user's transaction history
router.get('/transactions', protect, getTransactionHistory);

// Create a new wallet
router.post('/', protect, [
  body('userId').isMongoId().withMessage('Invalid user ID')
], createWallet);

// Add funds to wallet
router.post('/add-funds', protect, [
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0')
], addFunds);

// Deduct funds from wallet
router.post('/deduct-funds', protect, [
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0')
], deductFunds);

// Paystack deposit flows
router.post('/paystack/initialize', protect, initializeDeposit);
router.get('/paystack/verify/:reference', protect, verifyDeposit);

module.exports = router;
