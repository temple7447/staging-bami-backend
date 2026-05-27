const BankDeposit = require('../models/BankDeposit');
const Wallet = require('../models/Wallet');
const Tenant = require('../models/Tenant');
const { cloudinary, ensureCloudinaryConfigured } = require('../config/cloudinary');
const { logError, logInfo } = require('../utils/logger');
const { sendActivityToSlack } = require('../utils/slackService');

// UBA bank account details
const BANK_DETAILS = {
  bankName: 'UBA',
  accountNumber: '1027525073',
  accountName: 'UNITED TRADING INTEGRATED VENTURES ACC 1'
};

// @desc  Get UBA bank account details (shown before upload)
// @route GET /api/bank-deposits/bank-info
// @access Private (tenant / any authenticated user)
exports.getBankInfo = (req, res) => {
  res.status(200).json({
    success: true,
    data: BANK_DETAILS
  });
};

// @desc  Submit a bank deposit with proof image
// @route POST /api/bank-deposits
// @access Private
exports.submitDeposit = async (req, res) => {
  try {
    ensureCloudinaryConfigured();

    const { amount } = req.body;

    if (!amount || isNaN(amount) || Number(amount) <= 0) {
      return res.status(400).json({ success: false, message: 'A valid deposit amount is required' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'Proof of payment image is required' });
    }

    // Upload proof image to Cloudinary
    const folder = (process.env.CLOUDINARY_FOLDER || 'uploads') + '/bank-deposits';
    const uploadResult = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        { folder, resource_type: 'image' },
        (err, result) => { if (err) return reject(err); resolve(result); }
      );
      stream.end(req.file.buffer);
    });

    // Link to tenant if user has one
    const tenant = await Tenant.findOne({ user: req.user._id, isActive: true }).lean();

    const deposit = await BankDeposit.create({
      user: req.user._id,
      tenant: tenant?._id,
      amount: Number(amount),
      proofImageUrl: uploadResult.secure_url,
      proofImagePublicId: uploadResult.public_id,
      ...BANK_DETAILS,
      createdBy: req.user._id
    });

    sendActivityToSlack('New Bank Deposit Submitted', {
      user: req.user.email || req.user.name,
      amount: `₦${Number(amount).toLocaleString()}`,
      depositId: deposit._id.toString(),
      status: 'pending'
    }, '#f39c12', '🏦');

    res.status(201).json({
      success: true,
      message: 'Deposit submitted successfully. An admin will review and credit your wallet shortly.',
      data: {
        depositId: deposit._id,
        amount: deposit.amount,
        status: deposit.status,
        submittedAt: deposit.createdAt
      }
    });
  } catch (error) {
    logError('submitDeposit error', error);
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: messages.join('. ') });
    }
    res.status(500).json({ success: false, message: 'Server error submitting deposit' });
  }
};

// @desc  Get own deposit history (tenant/user)
// @route GET /api/bank-deposits/my
// @access Private
exports.getMyDeposits = async (req, res) => {
  try {
    const { page = 1, limit = 20, status } = req.query;
    const filter = { user: req.user._id };
    if (status) filter.status = status;

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [deposits, total] = await Promise.all([
      BankDeposit.find(filter)
        .populate('reviewedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      BankDeposit.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      count: deposits.length,
      total,
      pages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      data: deposits
    });
  } catch (error) {
    logError('getMyDeposits error', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc  Get all deposit submissions (admin view)
// @route GET /api/bank-deposits
// @access Protected (admin / super_admin)
exports.getAllDeposits = async (req, res) => {
  try {
    const { page = 1, limit = 20, status, userId, search } = req.query;

    const filter = {};
    if (status) filter.status = status;
    if (userId) filter.user = userId;
    if (search) {
      filter.$or = [
        { accountName: new RegExp(search, 'i') }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [deposits, total] = await Promise.all([
      BankDeposit.find(filter)
        .populate('user', 'name email')
        .populate('tenant', 'tenantName unitLabel')
        .populate('reviewedBy', 'name email')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      BankDeposit.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      count: deposits.length,
      total,
      pages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      data: deposits
    });
  } catch (error) {
    logError('getAllDeposits error', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc  Get single deposit
// @route GET /api/bank-deposits/:id
// @access Protected
exports.getDeposit = async (req, res) => {
  try {
    const deposit = await BankDeposit.findById(req.params.id)
      .populate('user', 'name email')
      .populate('tenant', 'tenantName unitLabel')
      .populate('reviewedBy', 'name email')
      .lean();

    if (!deposit) {
      return res.status(404).json({ success: false, message: 'Deposit not found' });
    }

    // Non-admins can only view their own deposits
    if (!['super_admin', 'admin'].includes(req.user.role)) {
      if (deposit.user._id?.toString() !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorised' });
      }
    }

    res.status(200).json({ success: true, data: deposit });
  } catch (error) {
    logError('getDeposit error', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc  Approve a deposit — credits the user's wallet
// @route PATCH /api/bank-deposits/:id/approve
// @access Protected (admin / super_admin)
exports.approveDeposit = async (req, res) => {
  try {
    const { adminNote } = req.body;

    const deposit = await BankDeposit.findById(req.params.id);
    if (!deposit) {
      return res.status(404).json({ success: false, message: 'Deposit not found' });
    }

    if (deposit.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Deposit already ${deposit.status}. Only pending deposits can be approved.`
      });
    }

    // Credit wallet
    let wallet = await Wallet.findOne({ userId: deposit.user });
    if (!wallet) {
      wallet = await Wallet.create({
        userId: deposit.user,
        balance: 0,
        totalEarnings: 0,
        totalSpent: 0,
        currency: 'NGN'
      });
    }

    wallet.balance += deposit.amount;
    wallet.totalEarnings += deposit.amount;
    wallet.lastUpdated = new Date();
    await wallet.save();

    // Mark deposit as approved
    const ref = `bank_deposit_${deposit._id}_${Date.now()}`;
    deposit.status = 'approved';
    deposit.adminNote = adminNote || undefined;
    deposit.reviewedBy = req.user._id;
    deposit.reviewedAt = new Date();
    deposit.walletTransactionRef = ref;
    await deposit.save();

    logInfo('Bank deposit approved', {
      depositId: deposit._id,
      userId: deposit.user,
      amount: deposit.amount,
      approvedBy: req.user._id
    });

    sendActivityToSlack('Bank Deposit Approved', {
      depositId: deposit._id.toString(),
      amount: `₦${deposit.amount.toLocaleString()}`,
      approvedBy: req.user.email || req.user.name,
      newWalletBalance: `₦${wallet.balance.toLocaleString()}`
    }, '#36a64f', '✅');

    res.status(200).json({
      success: true,
      message: `Deposit of ₦${deposit.amount.toLocaleString()} approved. Wallet credited.`,
      data: {
        depositId: deposit._id,
        amount: deposit.amount,
        status: deposit.status,
        newWalletBalance: wallet.balance
      }
    });
  } catch (error) {
    logError('approveDeposit error', error);
    res.status(500).json({ success: false, message: 'Server error approving deposit' });
  }
};

// @desc  Reject a deposit
// @route PATCH /api/bank-deposits/:id/reject
// @access Protected (admin / super_admin)
exports.rejectDeposit = async (req, res) => {
  try {
    const { adminNote } = req.body;

    const deposit = await BankDeposit.findById(req.params.id);
    if (!deposit) {
      return res.status(404).json({ success: false, message: 'Deposit not found' });
    }

    if (deposit.status !== 'pending') {
      return res.status(400).json({
        success: false,
        message: `Deposit already ${deposit.status}. Only pending deposits can be rejected.`
      });
    }

    deposit.status = 'rejected';
    deposit.adminNote = adminNote || undefined;
    deposit.reviewedBy = req.user._id;
    deposit.reviewedAt = new Date();
    await deposit.save();

    logInfo('Bank deposit rejected', {
      depositId: deposit._id,
      userId: deposit.user,
      amount: deposit.amount,
      rejectedBy: req.user._id
    });

    res.status(200).json({
      success: true,
      message: 'Deposit rejected.',
      data: { depositId: deposit._id, status: deposit.status }
    });
  } catch (error) {
    logError('rejectDeposit error', error);
    res.status(500).json({ success: false, message: 'Server error rejecting deposit' });
  }
};
