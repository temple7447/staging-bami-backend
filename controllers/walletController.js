const axios = require('axios');
const Wallet = require('../models/Wallet');
const WalletAccount = require('../models/WalletAccount');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const Withdrawal = require('../models/Withdrawal');
const { validationResult } = require('express-validator');
const { sendDepositEmail, sendWithdrawalEmail, sendTransactionNotificationEmail } = require('../utils/walletEmailService');

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

// Add funds to wallet (via Paystack)
const addFunds = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const { amount } = req.body;

    if (!amount || amount < 100) {
      return res.status(400).json({ success: false, message: 'Minimum deposit is ₦100' });
    }

    const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;
    const callback_url = `${process.env.FRONTEND_URL}/wallet/verify`;

    const payload = {
      email: req.user.email,
      amount: amount * 100,
      callback_url,
      metadata: {
        user_id: req.user.id,
        payment_type: 'wallet_deposit'
      }
    };

    const response = await axios.post(
      'https://api.paystack.co/transaction/initialize',
      payload,
      {
        headers: {
          Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`,
          'Content-Type': 'application/json'
        }
      }
    );

    res.status(200).json({
      success: true,
      message: 'Paystack payment initialized',
      data: response.data.data
    });
  } catch (error) {
    console.error('Add funds error:', error.response ? error.response.data : error.message);
    res.status(500).json({
      success: false,
      message: 'Failed to initialize Paystack payment',
      error: error.response ? error.response.data.message : error.message
    });
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

    // Send withdrawal/debit email notification
    try {
      const user = await User.findById(req.user.id);
      await sendWithdrawalEmail(user, amount, { _id: 'WALLET-WD-' + Date.now(), newBalance: wallet.balance });
    } catch (emailError) {
      console.error('Failed to send withdrawal email:', emailError.message);
    }

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

// @desc    Unified wallet transaction (deposit, withdraw, transfer)
// @route   POST /api/wallet/transaction
// @access  Private (all roles)
const processWalletTransaction = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const { type, amount, description, recipientEmail, recipientId, recipientType, bankDetails } = req.body;

    const wallet = await Wallet.findOne({ userId: req.user.id });
    if (!wallet) {
      return res.status(404).json({ success: false, message: 'Wallet not found' });
    }

    let result;

    switch (type) {
      case 'deposit':
        result = await handleDeposit(wallet, amount, description, req.user);
        break;
      case 'withdraw':
        result = await handleWithdraw(wallet, amount, description, bankDetails, req.user);
        break;
      case 'transfer':
        result = await handleTransfer(wallet, amount, description, recipientEmail, recipientId, recipientType, req.user);
        break;
      default:
        return res.status(400).json({ success: false, message: 'Invalid transaction type' });
    }

    res.status(200).json(result);
  } catch (err) {
    console.error('Wallet transaction error:', err);

    if (err.message.includes('Insufficient') || err.message.includes('not found') || err.message.includes('Invalid')) {
      return res.status(400).json({ success: false, message: err.message });
    }

    res.status(500).json({ success: false, message: 'Server error occurred while processing transaction' });
  }
};

const handleDeposit = async (wallet, amount, description, user) => {
  wallet.balance += amount;
  wallet.totalEarnings += amount;
  wallet.lastUpdated = new Date();
  await wallet.save();

  const transaction = await Transaction.create({
    user: user._id,
    walletId: wallet._id,
    amount,
    type: 'deposit',
    method: 'other',
    status: 'completed',
    reference: 'DEP-' + Date.now(),
    description: description || 'Wallet deposit',
    createdBy: user._id
  });

  wallet.transactions.push(transaction._id);
  await wallet.save();

  try {
    await sendDepositEmail(user, amount, { _id: transaction._id, newBalance: wallet.balance }, 'Wallet Deposit');
  } catch (emailError) {
    console.error('Failed to send deposit email:', emailError.message);
  }

  return {
    success: true,
    message: 'Deposit successful',
    data: {
      transaction: transaction._id,
      amount,
      newBalance: wallet.balance,
      type: 'deposit'
    }
  };
};

const handleWithdraw = async (wallet, amount, description, bankDetails, user) => {
  if (wallet.balance < amount) {
    throw new Error('Insufficient balance');
  }

  const withdrawal = await Withdrawal.create({
    user: user._id,
    amount,
    bankDetails: bankDetails || {
      accountName: user.bankDetails?.accountName || '',
      accountNumber: user.bankDetails?.accountNumber || '',
      bankName: user.bankDetails?.bankName || ''
    },
    status: 'pending',
    reference: 'WD-' + Date.now()
  });

  wallet.balance -= amount;
  wallet.totalSpent += amount;
  wallet.lastUpdated = new Date();
  await wallet.save();

  const transaction = await Transaction.create({
    user: user._id,
    walletId: wallet._id,
    amount,
    type: 'withdrawal',
    method: 'bank',
    status: 'completed',
    reference: withdrawal.reference,
    description: description || 'Wallet withdrawal',
    createdBy: user._id
  });

  wallet.transactions.push(transaction._id);
  await wallet.save();

  try {
    await sendWithdrawalEmail(user, amount, { _id: withdrawal._id, newBalance: wallet.balance });
  } catch (emailError) {
    console.error('Failed to send withdrawal email:', emailError.message);
  }

  return {
    success: true,
    message: 'Withdrawal request submitted successfully',
    data: {
      withdrawal: withdrawal._id,
      amount,
      newBalance: wallet.balance,
      status: withdrawal.status,
      type: 'withdraw'
    }
  };
};

const handleTransfer = async (wallet, amount, description, recipientEmail, recipientId, recipientType, user) => {
  if (wallet.balance < amount) {
    throw new Error('Insufficient balance');
  }

  let recipientWallet, recipientUser, estateWallet;

  if (recipientType === 'estate') {
    const targetId = recipientId || recipientEmail;
    if (!targetId) {
      throw new Error('Estate ID is required for estate transfers');
    }
    estateWallet = await WalletAccount.findOne({ estate: targetId });
    if (!estateWallet) {
      throw new Error('Estate wallet not found');
    }
  } else {
    if (recipientEmail) {
      recipientUser = await User.findOne({ email: recipientEmail });
    } else if (recipientId) {
      recipientUser = await User.findById(recipientId);
    }

    if (!recipientUser) {
      throw new Error('Recipient not found');
    }

    if (recipientUser._id.toString() === user._id.toString()) {
      throw new Error('Cannot transfer to yourself');
    }

    recipientWallet = await Wallet.findOne({ userId: recipientUser._id });
    if (!recipientWallet) {
      recipientWallet = await Wallet.create({
        userId: recipientUser._id,
        currency: 'NGN'
      });
    }
  }

  wallet.balance -= amount;
  wallet.totalSpent += amount;
  wallet.lastUpdated = new Date();
  await wallet.save();

  if (recipientType === 'estate') {
    estateWallet.totalReceived += amount;
    await estateWallet.distributeAmount(amount);
    estateWallet.lastUpdated = new Date();
    await estateWallet.save();
  } else {
    recipientWallet.balance += amount;
    recipientWallet.totalEarnings += amount;
    recipientWallet.lastUpdated = new Date();
    await recipientWallet.save();

    const recipientTransaction = await Transaction.create({
      user: recipientUser._id,
      walletId: recipientWallet._id,
      amount,
      type: 'deposit',
      method: 'transfer',
      status: 'completed',
      reference: 'TRF-IN-' + Date.now(),
      description: `Transfer received from ${user.name}`,
      createdBy: user._id
    });

    recipientWallet.transactions.push(recipientTransaction._id);
    await recipientWallet.save();
  }

  const reference = 'TRF-' + Date.now();
  const transaction = await Transaction.create({
    user: user._id,
    walletId: wallet._id,
    amount,
    type: 'transfer',
    method: 'transfer',
    status: 'completed',
    reference,
    description: description || `Transfer to ${recipientType === 'estate' ? 'estate' : recipientUser.name}`,
    createdBy: user._id
  });

  wallet.transactions.push(transaction._id);
  await wallet.save();

  return {
    success: true,
    message: 'Transfer successful',
    data: {
      transaction: transaction._id,
      amount,
      newBalance: wallet.balance,
      recipient: recipientType === 'estate' ? recipientId : recipientUser.name,
      recipientType,
      type: 'transfer'
    }
  };
};

// @desc    Get user's transaction history (own transactions only)
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

// @desc    Unified transaction list - role-based access
// @route   GET /api/wallet/transactions/list
// @access  Private (all roles)
const getAllTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20, type, status, search, startDate, endDate } = req.query;
    const pageNum = parseInt(page);
    const limitNum = parseInt(limit);
    const skip = (pageNum - 1) * limitNum;
    const role = req.user.role;

    const filter = { isActive: true };

    if (['super_admin'].includes(role)) {
      // Super admin sees everything — no estate scoping needed
    } else if (['admin', 'super_manager'].includes(role)) {
      // Admins are linked to estates via Estate.managers — look them up
      const managedEstates = await require('../models/Estate').find(
        { managers: req.user.id, isActive: true }, '_id'
      ).lean();
      const estateIds = managedEstates.map(e => e._id);
      filter.estate = { $in: estateIds };
    } else if (role === 'business_owner') {
      // Business owners are linked via User.assignedEstates
      const estateIds = req.user.assignedEstates || [];
      filter.estate = { $in: estateIds };
    } else {
      // All other roles: only their own transactions
      filter.user = req.user.id;
    }

    if (type) filter.type = type;
    if (status) filter.status = status;
    if (startDate || endDate) {
      filter.createdAt = {};
      if (startDate) filter.createdAt.$gte = new Date(startDate);
      if (endDate) filter.createdAt.$lte = new Date(endDate);
    }
    if (search) {
      filter.$or = [
        { description: { $regex: search, $options: 'i' } },
        { reference: { $regex: search, $options: 'i' } }
      ];
    }

    const [transactions, total] = await Promise.all([
      Transaction.find(filter)
        .populate('user', 'name email role')
        .populate('walletId', 'balance')
        .populate('estate', 'name')
        .populate('tenant', 'tenantName')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limitNum),
      Transaction.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      count: transactions.length,
      total,
      page: pageNum,
      pages: Math.ceil(total / limitNum),
      data: transactions
    });
  } catch (err) {
    console.error('Get all transactions error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while fetching transactions' });
  }
};

/**
 * Admin: look up a user by email before crediting their wallet.
 * Returns name, email, role, and current wallet balance for confirmation.
 * Query: ?email=tenant@mail.com
 */
const adminLookupUser = async (req, res) => {
  try {
    const adminRole = req.user?.role;
    if (!['admin', 'super_admin', 'super_manager', 'business_owner'].includes(adminRole)) {
      return res.status(403).json({ success: false, message: 'Not authorized' });
    }

    const email = req.query.email?.toLowerCase().trim();
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email query parameter is required' });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(404).json({ success: false, message: 'No user found with that email address' });
    }

    const wallet = await Wallet.findOne({ userId: user._id });

    return res.status(200).json({
      success: true,
      data: {
        userId: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone || null,
        walletBalance: wallet ? wallet.balance : 0,
        currency: 'NGN'
      }
    });
  } catch (err) {
    console.error('adminLookupUser error:', err);
    res.status(500).json({ success: false, message: 'Server error', error: err.message });
  }
};

/**
 * Admin: credit any user's wallet directly without going through Paystack.
 * Body: { email, amount, reason? }
 */
const adminCreditWallet = async (req, res) => {
  try {
    const adminRole = req.user?.role;
    if (!['admin', 'super_admin', 'super_manager', 'business_owner'].includes(adminRole)) {
      return res.status(403).json({ success: false, message: 'Not authorized to credit wallets' });
    }

    const { email, amount, reason } = req.body;

    if (!email) {
      return res.status(400).json({ success: false, message: 'Recipient email is required' });
    }

    const creditAmount = Number(amount);
    if (!creditAmount || creditAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Amount must be a positive number' });
    }

    const recipient = await User.findOne({ email: email.toLowerCase().trim() });
    if (!recipient) {
      return res.status(404).json({ success: false, message: 'User not found' });
    }

    // Find or create wallet
    let wallet = await Wallet.findOne({ userId: recipient._id });
    if (!wallet) {
      wallet = await Wallet.create({ userId: recipient._id });
    }

    wallet.balance += creditAmount;
    wallet.totalEarnings += creditAmount;
    wallet.lastUpdated = new Date();
    await wallet.save();

    const transaction = await Transaction.create({
      user: recipient._id,
      walletId: wallet._id,
      amount: creditAmount,
      type: 'deposit',
      method: 'other',
      status: 'completed',
      reference: 'ADM-' + Date.now(),
      description: reason || `Admin wallet credit by ${req.user.name || req.user.email}`,
      createdBy: req.user._id
    });

    wallet.transactions.push(transaction._id);
    await wallet.save();

    try {
      await sendDepositEmail(recipient, creditAmount, { _id: transaction._id, newBalance: wallet.balance }, 'Admin Wallet Credit');
    } catch (emailErr) {
      console.error('Failed to send credit notification email:', emailErr.message);
    }

    return res.status(200).json({
      success: true,
      message: `Successfully credited ₦${creditAmount.toLocaleString()} to ${recipient.name || recipient.email}'s wallet`,
      data: {
        transactionId: transaction._id,
        recipient: { id: recipient._id, name: recipient.name, email: recipient.email },
        amountCredited: creditAmount,
        newBalance: wallet.balance
      }
    });
  } catch (err) {
    console.error('adminCreditWallet error:', err);
    res.status(500).json({ success: false, message: 'Failed to credit wallet', error: err.message });
  }
};

module.exports = {
  getWallet,
  createWallet,
  addFunds,
  deductFunds,
  getTransactionHistory,
  getAllTransactions,
  processWalletTransaction,
  adminLookupUser,
  adminCreditWallet
};
