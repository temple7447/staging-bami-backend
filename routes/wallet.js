const express = require('express');
const { protect } = require('../middleware/auth');
const { body } = require('express-validator');
const {
  getWallet,
  createWallet,
  addFunds,
  deductFunds,
  updateCurrency
} = require('../controllers/walletController');

const router = express.Router();

// Get current user's wallet
router.get('/', protect, getWallet);

// Create a new wallet
router.post('/', protect, [
  body('userId').isMongoId().withMessage('Invalid user ID'),
  body('currency').optional().isIn(['GBP', 'USD', 'EUR']).withMessage('Invalid currency')
], createWallet);

// Add funds to wallet
router.post('/add-funds', protect, [
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0')
], addFunds);

// Deduct funds from wallet
router.post('/deduct-funds', protect, [
  body('amount').isFloat({ min: 0.01 }).withMessage('Amount must be greater than 0')
], deductFunds);

// Update wallet currency
router.put('/currency', protect, [
  body('currency').isIn(['GBP', 'USD', 'EUR']).withMessage('Invalid currency')
], updateCurrency);

module.exports = router;
