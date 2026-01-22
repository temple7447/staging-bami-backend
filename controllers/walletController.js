const Wallet = require('../models/Wallet');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const { validationResult } = require('express-validator');

// Get wallet balance
const getWallet = async (req, res) => {
  try {
    let wallet = await Wallet.findOne({ userId: req.user.id }).populate('userId', 'name email');

    if (!wallet) {
      // Lazy creation
      wallet = await Wallet.create({
        userId: req.user.id,
        currency: 'NGN'
      });
      // Populate for consistency
      await wallet.populate('userId', 'name email');
    }

    console.log(`[getWallet] User: ${req.user.email}, Balance: ${wallet.balance}`);

    // Set cache-control to prevent stale balance
    res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');

    res.status(200).json({
      success: true,
      data: {
        ...wallet.toObject({ getters: true, virtuals: true }),
        currencySymbol: '₦',
        currency: 'NGN'
      }
    });
  } catch (err) {
    console.error('Get wallet error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while fetching/creating wallet' });
  }
};

// Create wallet (typically called when user registers)
const createWallet = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const { userId } = req.body;

    // Check if user exists
    const user = await User.findById(userId);
    if (!user) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Check if wallet already exists
    const existingWallet = await Wallet.findOne({ userId });
    if (existingWallet) {
      return res.status(400).json({ success: false, message: 'Wallet already exists for this user' });
    }

    const wallet = await Wallet.create({
      userId,
      currency: 'NGN'
    });

    res.status(201).json({ success: true, message: 'Wallet created successfully', data: wallet });
  } catch (err) {
    console.error('Create wallet error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while creating wallet' });
  }
};

// Add funds to wallet
const addFunds = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const { amount } = req.body;

    const wallet = await Wallet.findOne({ userId: req.user.id });
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    wallet.balance += amount;
    wallet.totalEarnings += amount;
    wallet.lastUpdated = new Date();
    await wallet.save();

    res.status(200).json({
      success: true,
      message: 'Funds added successfully',
      data: {
        ...wallet.toObject(),
        currencySymbol: '₦',
        currency: 'NGN'
      }
    });
  } catch (err) {
    console.error('Add funds error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while adding funds' });
  }
};

// Deduct funds from wallet
const deductFunds = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const { amount } = req.body;

    const wallet = await Wallet.findOne({ userId: req.user.id });
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    if (wallet.balance < amount) {
      return res.status(400).json({ success: false, message: 'Insufficient balance' });
    }

    wallet.balance -= amount;
    wallet.totalSpent += amount;
    wallet.lastUpdated = new Date();
    await wallet.save();

    res.status(200).json({
      success: true,
      message: 'Funds deducted successfully',
      data: {
        ...wallet.toObject(),
        currencySymbol: '₦',
        currency: 'NGN'
      }
    });
  } catch (err) {
    console.error('Deduct funds error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while deducting funds' });
  }
};

// @desc    Get user's transaction history
// @route   GET /api/wallet/transactions
// @access  Private
const getTransactionHistory = async (req, res) => {
  try {
    const transactions = await Transaction.find({
      user: req.user.id,
      isActive: true
    }).sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: transactions.length,
      data: transactions
    });
  } catch (err) {
    console.error('Get transaction history error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while fetching transaction history' });
  }
};

module.exports = {
  getWallet,
  createWallet,
  addFunds,
  deductFunds,
  getTransactionHistory
};
