const Withdrawal = require('../models/Withdrawal');
const Wallet = require('../models/Wallet');
const User = require('../models/User');
const Transaction = require('../models/Transaction');
const crypto = require('crypto');
const { logError } = require('../utils/logger');
const { createNotification } = require('../utils/notificationService');
const { sendWithdrawalToSlack } = require('../utils/slackService');
const { sendWithdrawalEmail } = require('../utils/walletEmailService');

// @desc    Request a withdrawal
// @route   POST /api/withdrawals/request
// @access  Private
exports.requestWithdrawal = async (req, res) => {
    try {
        const { amount, bankDetails } = req.body;

        // 1. Validate user has enough balance
        const wallet = await Wallet.findOne({ userId: req.user.id });
        if (!wallet || wallet.balance < amount) {
            return res.status(400).json({
                success: false,
                message: 'Insufficient balance for this withdrawal'
            });
        }

        // 2. Use provided bank details or saved ones
        const user = await User.findById(req.user.id);
        const effectiveBankDetails = bankDetails || user.bankDetails;

        if (!effectiveBankDetails || !effectiveBankDetails.accountNumber) {
            return res.status(400).json({
                success: false,
                message: 'Bank details are required for withdrawal'
            });
        }

        // 3. Subtract from wallet immediately (freeze funds)
        wallet.balance -= amount;
        wallet.totalSpent += amount; // Marking as spent/frozen
        await wallet.save();

        // 4. Create withdrawal request
        const reference = 'WD-' + crypto.randomBytes(4).toString('hex').toUpperCase();

        const withdrawal = await Withdrawal.create({
            user: req.user.id,
            amount,
            bankDetails: effectiveBankDetails,
            reference,
            status: 'pending'
        });

        // 5. Send Notification
        await createNotification({
            user: req.user.id,
            title: 'Withdrawal Initiated',
            message: `Your withdrawal request for ₦${amount.toLocaleString()} has been received and is pending approval.`,
            type: 'withdrawal',
            metadata: { reference, amount }
        });

        sendWithdrawalToSlack(withdrawal, user.email, 'requested');

        // Send email notification
        try {
          await sendWithdrawalEmail(user, amount, { _id: withdrawal._id, reference, newBalance: wallet.balance }, effectiveBankDetails);
        } catch (emailError) {
          console.error('Failed to send withdrawal email:', emailError.message);
        }

        res.status(201).json({
            success: true,
            message: 'Withdrawal request submitted successfully',
            data: withdrawal
        });
    } catch (error) {
        logError('requestWithdrawal error', error);
        res.status(500).json({
            success: false,
            message: 'Error submitting withdrawal request',
            error: error.message
        });
    }
};

// @desc    Get my withdrawals
// @route   GET /api/withdrawals/my
// @access  Private
exports.getMyWithdrawals = async (req, res) => {
    try {
        const withdrawals = await Withdrawal.find({ user: req.user.id, isActive: true })
            .sort({ createdAt: -1 });

        res.status(200).json({
            success: true,
            count: withdrawals.length,
            data: withdrawals
        });
    } catch (error) {
        logError('getMyWithdrawals error', error);
        res.status(500).json({
            success: false,
            message: 'Error fetching withdrawals'
        });
    }
};

// @desc    Update withdrawal status (Admin/Super Admin only)
// @route   PUT /api/withdrawals/:id/status
// @access  Private (Admin/Super Admin)
exports.updateWithdrawalStatus = async (req, res) => {
    try {
        const { status, adminNotes } = req.body;
        const withdrawal = await Withdrawal.findById(req.params.id);

        if (!withdrawal) {
            return res.status(404).json({ success: false, message: 'Withdrawal request not found' });
        }

        if (withdrawal.status === 'completed' || withdrawal.status === 'rejected') {
            return res.status(400).json({
                success: false,
                message: `This request is already ${withdrawal.status} and cannot be changed`
            });
        }

        if (status === 'rejected') {
            const wallet = await Wallet.findOne({ userId: withdrawal.user });
            if (wallet) {
                wallet.balance += withdrawal.amount;
                wallet.totalSpent -= withdrawal.amount;
                await wallet.save();
            }
        }

        withdrawal.status = status;
        if (adminNotes) withdrawal.adminNotes = adminNotes;
        withdrawal.processedAt = Date.now();
        withdrawal.processedBy = req.user.id;

        await withdrawal.save();

        // Record as a Transaction for central history
        if (status === 'completed') {
            try {
                await Transaction.create({
                    user: withdrawal.user,
                    amount: withdrawal.amount,
                    type: 'withdrawal',
                    method: 'bank',
                    status: 'completed',
                    reference: withdrawal.reference,
                    description: `Withdrawal to ${withdrawal.bankDetails?.bankName} (${withdrawal.bankDetails?.accountNumber})`,
                    metadata: { withdrawalId: withdrawal._id, bankDetails: withdrawal.bankDetails },
                    createdBy: req.user.id
                });
            } catch (txError) {
                console.error('[Withdrawal] Failed to create Transaction record:', txError.message);
            }
        }

        // Notify user about status change
        const notificationTitle = status === 'completed' ? 'Withdrawal Approved' : 'Withdrawal Rejected';
        const notificationMessage = status === 'completed'
            ? `Your withdrawal of ₦${withdrawal.amount.toLocaleString()} has been processed successfully.`
            : `Your withdrawal request for ₦${withdrawal.amount.toLocaleString()} was rejected.${adminNotes ? ' Reason: ' + adminNotes : ''}`;

        await createNotification({
            user: withdrawal.user,
            title: notificationTitle,
            message: notificationMessage,
            type: 'withdrawal',
            metadata: { reference: withdrawal.reference, status, adminNotes }
        });

        const user = await User.findById(withdrawal.user);
        if (user) {
            sendWithdrawalToSlack(withdrawal, user.email, status);
        }

        res.status(200).json({
            success: true,
            message: `Withdrawal request ${status}`,
            data: withdrawal
        });
    } catch (error) {
        logError('updateWithdrawalStatus error', error);
        res.status(500).json({
            success: false,
            message: 'Error updating withdrawal status'
        });
    }
};
