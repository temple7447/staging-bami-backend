const mongoose = require('mongoose');

const BillingItemSchema = new mongoose.Schema({
    user: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: true
    },
    tenant: {
        type: mongoose.Schema.ObjectId,
        ref: 'Tenant'
    },
    estate: {
        type: mongoose.Schema.ObjectId,
        ref: 'Estate'
    },
    itemType: {
        type: String,
        enum: ['water_bill', 'electricity_bill', 'parking_space', 'cleaning_service', 'maintenance_fee', 'garden_maintenance', 'other'],
        required: true
    },
    label: {
        type: String,
        required: [true, 'Label is required'],
        trim: true,
        maxlength: [200, 'Label cannot be more than 200 characters']
    },
    amount: {
        type: Number,
        required: [true, 'Amount is required'],
        min: [0, 'Amount cannot be negative']
    },
    currency: {
        type: String,
        default: 'NGN',
        enum: ['NGN']
    },
    dueDate: {
        type: Date
    },
    description: {
        type: String,
        maxlength: [500, 'Description cannot be more than 500 characters']
    },
    isRecurring: {
        type: Boolean,
        default: false
    },
    frequency: {
        type: String,
        enum: ['once', 'monthly', 'quarterly', 'annually'],
        default: 'once'
    },
    isPaid: {
        type: Boolean,
        default: false
    },
    paidDate: {
        type: Date
    },
    paymentReference: {
        type: mongoose.Schema.ObjectId,
        ref: 'Payment'
    },
    isActive: {
        type: Boolean,
        default: true
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

// Indexes for efficient querying
BillingItemSchema.index({ user: 1, isPaid: 1, isActive: 1 });
BillingItemSchema.index({ tenant: 1, isPaid: 1, isActive: 1 });
BillingItemSchema.index({ estate: 1, isPaid: 1, isActive: 1 });
BillingItemSchema.index({ dueDate: 1 });
BillingItemSchema.index({ createdAt: -1 });

// Virtual for category classification
BillingItemSchema.virtual('category').get(function () {
    const categoryMap = {
        'water_bill': 'utilities',
        'electricity_bill': 'utilities',
        'parking_space': 'facility',
        'cleaning_service': 'service',
        'maintenance_fee': 'service',
        'garden_maintenance': 'service',
        'other': 'other'
    };
    return categoryMap[this.itemType] || 'other';
});

// Method to format amount
BillingItemSchema.methods.getFormattedAmount = function () {
    const formatter = new Intl.NumberFormat('en-NG', {
        style: 'currency',
        currency: this.currency
    });
    return formatter.format(this.amount);
};

module.exports = mongoose.model('BillingItem', BillingItemSchema);
