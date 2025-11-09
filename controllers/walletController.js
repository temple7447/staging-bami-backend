const Wallet = require('../models/Wallet');
const User = require('../models/User');
const { validationResult } = require('express-validator');

// Get wallet balance
const getWallet = async (req, res) => {
  try {
    const wallet = await Wallet.findOne({ userId: req.user.id }).populate('userId', 'name email');
    
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }
    
    res.status(200).json({ 
      success: true, 
      data: {
        ...wallet.toObject(),
        currencySymbol: wallet.currency === 'GBP' ? '£' : wallet.currency === 'USD' ? '$' : '€'
      }
    });
  } catch (err) {
    console.error('Get wallet error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while fetching wallet' });
  }
};

// Create wallet (typically called when user registers)
const createWallet = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const { userId, currency = 'GBP' } = req.body;

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
      currency: currency.toUpperCase()
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
        currencySymbol: '£'
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
        currencySymbol: '£'
      }
    });
  } catch (err) {
    console.error('Deduct funds error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while deducting funds' });
  }
};

// Update currency
const updateCurrency = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const { currency } = req.body;

    const wallet = await Wallet.findOne({ userId: req.user.id });
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    wallet.currency = currency.toUpperCase();
    wallet.lastUpdated = new Date();
    await wallet.save();

    res.status(200).json({ 
      success: true, 
      message: 'Currency updated successfully', 
      data: wallet
    });
  } catch (err) {
    console.error('Update currency error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while updating currency' });
  }
};

module.exports = {
  getWallet,
  createWallet,
  addFunds,
  deductFunds,
  updateCurrency
};
