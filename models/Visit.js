const mongoose = require('mongoose');

const VisitSchema = new mongoose.Schema({
    tenant: {
        type: mongoose.Schema.ObjectId,
        ref: 'Tenant',
        required: true
    },
    estate: {
        type: mongoose.Schema.ObjectId,
        ref: 'Estate',
        required: true
    },
    scheduledDate: {
        type: Date,
        required: true
    },
    completedDate: {
        type: Date
    },
    status: {
        type: String,
        enum: ['scheduled', 'completed', 'cancelled'],
        default: 'scheduled'
    },
    visitType: {
        type: String,
        enum: ['month3-followup', 'overdue-collection', 'general-inspection', 'other'],
        default: 'month3-followup'
    },
    notes: {
        type: String
    },
    assignedTo: {
        type: mongoose.Schema.ObjectId,
        ref: 'User'
    },
    outcome: {
        type: String
    },
    paymentReceived: {
        type: Boolean,
        default: false
    },
    amountReceived: {
        type: Number,
        default: 0
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Indexes for performance
VisitSchema.index({ tenant: 1, scheduledDate: -1 });
VisitSchema.index({ estate: 1, scheduledDate: -1 });
VisitSchema.index({ assignedTo: 1, scheduledDate: -1 });
VisitSchema.index({ status: 1, scheduledDate: 1 });

module.exports = mongoose.model('Visit', VisitSchema);
