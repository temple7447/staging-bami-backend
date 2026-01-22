const mongoose = require('mongoose');

const WithdrawalSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: true
    },
    amount: {
        type: Number,
        required: [true, 'Please provide an amount'],
        min: [100, 'Minimum withdrawal amount is ₦100']
    },
    bankDetails: {
        accountName: String,
        accountNumber: String,
        bankName: String,
        bankCode: String
    },
    status: {
        type: String,
        enum: ['pending', 'approved', 'rejected', 'completed'],
        default: 'pending'
    },
    reference: {
        type: String,
        unique: true
    },
    adminNotes: {
        type: String
    },
    processedAt: {
        type: Date
    },
    processedBy: {
        type: mongoose.Schema.ObjectId,
        ref: 'User'
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Index for filtering
WithdrawalSchema.index({ user: 1, status: 1 });
WithdrawalSchema.index({ reference: 1 });
WithdrawalSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Withdrawal', WithdrawalSchema);
