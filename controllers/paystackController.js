const axios = require('axios');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const { logError } = require('../utils/logger');
const { createNotification } = require('../utils/notificationService');

const PAYSTACK_SECRET_KEY = process.env.PAYSTACK_SECRET_KEY;

// @desc    Initialize Paystack deposit
// @route   POST /api/wallet/paystack/initialize
// @access  Private
exports.initializeDeposit = async (req, res) => {
    try {
        const { amount } = req.body;

        if (!amount || amount < 100) {
            return res.status(400).json({ success: false, message: 'Minimum deposit is ₦100' });
        }

        const payload = {
            email: req.user.email,
            amount: amount * 100, // Paystack works in kobo
            callback_url: `${process.env.FRONTEND_URL}/wallet/verify`,
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
            data: response.data.data
        });
    } catch (error) {
        logError('initializeDeposit error', error.response ? error.response.data : error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to initialize payment',
            error: error.response ? error.response.data.message : error.message
        });
    }
};

// @desc    Verify Paystack deposit
// @route   GET /api/wallet/paystack/verify/:reference
// @access  Private
exports.verifyDeposit = async (req, res) => {
    try {
        const { reference } = req.params;

        const response = await axios.get(
            `https://api.paystack.co/transaction/verify/${reference}`,
            {
                headers: {
                    Authorization: `Bearer ${PAYSTACK_SECRET_KEY}`
                }
            }
        );

        const data = response.data.data;
        console.log(`[Paystack] Verification for ${reference}: ${data.status}`);

        if (data.status === 'success') {
            const amount = data.amount / 100; // Convert back from kobo

            // 1. Check if this reference has already been processed
            const existingTx = await Transaction.findOne({ reference: data.reference });
            if (existingTx) {
                const wallet = await Wallet.findOne({ userId: req.user.id });
                return res.status(200).json({
                    success: true,
                    message: 'Wallet already credited for this transaction',
                    data: {
                        newBalance: wallet ? wallet.balance : 0,
                        reference: data.reference
                    }
                });
            }

            console.log(`[Paystack] Crediting ${amount} to user ${req.user.id}`);

            // 2. Atomically update wallet and get new state
            const wallet = await Wallet.findOneAndUpdate(
                { userId: req.user.id },
                {
                    $inc: { balance: amount, totalEarnings: amount },
                    $set: { lastUpdated: Date.now() }
                },
                { new: true, upsert: true }
            );

            // 3. Create a Transaction record for history
            try {
                await Transaction.create({
                    user: req.user.id,
                    walletId: wallet._id,
                    amount,
                    type: 'deposit',
                    status: 'completed',
                    paymentMethod: 'paystack',
                    reference: data.reference,
                    description: 'Wallet funding via Paystack',
                    createdBy: req.user.id, // Mandatory field
                    metadata: data
                });

                // 4. Send Notification
                await createNotification({
                    user: req.user.id,
                    title: 'Wallet Funded',
                    message: `Your wallet has been credited with ₦${amount.toLocaleString()}`,
                    type: 'payment',
                    metadata: { reference: data.reference, amount }
                });

            } catch (txError) {
                console.error('[Paystack] Transaction/Notification failed:', txError.message);
            }

            res.status(200).json({
                success: true,
                message: 'Wallet credited successfully',
                data: {
                    newBalance: wallet.balance,
                    reference: data.reference
                }
            });
        } else {
            res.status(400).json({
                success: false,
                message: 'Payment verification failed',
                status: data.status
            });
        }
    } catch (error) {
        logError('verifyDeposit error', error.response ? error.response.data : error.message);
        res.status(500).json({
            success: false,
            message: 'Failed to verify payment',
            error: error.response ? error.response.data.message : error.message
        });
    }
};
