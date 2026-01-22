const mongoose = require('mongoose');

const ServiceRequestSchema = new mongoose.Schema({
    requester: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: true
    },
    vendor: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
        required: true
    },
    businessType: {
        type: mongoose.Schema.ObjectId,
        ref: 'BusinessType',
        required: true
    },
    estate: {
        type: mongoose.Schema.ObjectId,
        ref: 'Estate'
    },
    unit: {
        type: mongoose.Schema.ObjectId,
        ref: 'Unit'
    },
    description: {
        type: String,
        required: [true, 'Please provide a description of the requested service'],
        maxlength: [1000, 'Description cannot exceed 1000 characters']
    },
    scheduledDate: {
        type: Date,
        required: [true, 'Please provide a scheduled date']
    },
    status: {
        type: String,
        enum: ['pending', 'accepted', 'rejected', 'in-progress', 'completed', 'cancelled'],
        default: 'pending'
    },
    vendorNotes: {
        type: String
    },
    completionImage: {
        type: String // URL to image uploaded after work
    },
    isActive: {
        type: Boolean,
        default: true
    }
}, {
    timestamps: true
});

// Indexes for common queries
ServiceRequestSchema.index({ requester: 1, status: 1 });
ServiceRequestSchema.index({ vendor: 1, status: 1 });
ServiceRequestSchema.index({ estate: 1 });
ServiceRequestSchema.index({ createdAt: -1 });

module.exports = mongoose.model('ServiceRequest', ServiceRequestSchema);
