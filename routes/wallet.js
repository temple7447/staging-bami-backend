const express = require('express');
const { protect } = require('../middleware/auth');
const { body } = require('express-validator');
const { handleValidationErrors, validateWalletTransaction } = require('../middleware/validation');
const {
  getWallet,
  createWallet,
  addFunds,
  deductFunds,
  getTransactionHistory,
  getAllTransactions,
  processWalletTransaction
} = require('../controllers/walletController');
const {
  initializeDeposit,
  verifyDeposit
} = require('../controllers/paystackController');

const router = express.Router();

// Get current user's wallet
router.get('/', protect, getWallet);

// Get user's own transaction history
router.get('/transactions', protect, getTransactionHistory);

// Get all transactions (role-based: admin sees all, others see own)
router.get('/transactions/list', protect, getAllTransactions);

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

// Unified wallet transaction (deposit, withdraw, transfer)
router.post('/transaction', protect, validateWalletTransaction, handleValidationErrors, processWalletTransaction);

// Paystack deposit flows
router.post('/paystack/initialize', protect, initializeDeposit);
router.get('/paystack/verify/:reference', protect, verifyDeposit);

module.exports = router;
