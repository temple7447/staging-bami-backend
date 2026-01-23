const mongoose = require('mongoose');

const SubscriptionSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Subscription name is required'],
        trim: true,
        maxlength: [100, 'Subscription name cannot be more than 100 characters']
    },
    price: {
        type: Number,
        required: [true, 'Price is required'],
        min: [0, 'Price cannot be negative']
    },
    billingPeriod: {
        type: String,
        required: [true, 'Billing period is required'],
        enum: {
            values: ['month', 'year', 'week', 'day', 'one-time'],
            message: '{VALUE} is not a valid billing period'
        },
        default: 'month'
    },
    description: {
        type: String,
        trim: true,
        maxlength: [500, 'Description cannot be more than 500 characters']
    },
    icon: {
        type: String,
        enum: {
            values: ['Layout (Frontend)', 'Server (Backend)'],
            message: '{VALUE} is not a valid icon type'
        },
        default: 'Layout (Frontend)'
    },
    status: {
        type: String,
        enum: {
            values: ['Active', 'Inactive'],
            message: '{VALUE} is not a valid status'
        },
        default: 'Active'
    },
    features: {
        type: [String],
        default: []
    },
    isActive: {
        type: Boolean,
        default: true
    },
    startDate: {
        type: Date,
        default: Date.now
    },
    expiresAt: {
        type: Date
    },
    createdBy: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: true
    },
    updatedBy: {
        type: mongoose.Schema.ObjectId,
        ref: 'User'
    }
}, {
    timestamps: true
});

// Index for faster queries
SubscriptionSchema.index({ status: 1, isActive: 1 });
SubscriptionSchema.index({ billingPeriod: 1 });

module.exports = mongoose.model('Subscription', SubscriptionSchema);
