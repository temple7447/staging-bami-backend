const mongoose = require('mongoose');

const MediaSchema = new mongoose.Schema({
    url: { type: String, required: true },
    publicId: { type: String },
    type: { type: String, enum: ['image', 'video'], required: true }
}, { _id: false });

const TimelineEntrySchema = new mongoose.Schema({
    stage: {
        type: String,
        enum: ['review', 'started', 'inprogress', 'completed'],
        required: true
    },
    note: { type: String, maxlength: 1000 },
    media: [MediaSchema],
    updatedBy: { type: mongoose.Schema.ObjectId, ref: 'User', required: true },
    updatedAt: { type: Date, default: Date.now }
}, { _id: true });

const IssueSchema = new mongoose.Schema({
    title: {
        type: String,
        required: [true, 'Please provide an issue title'],
        trim: true,
        maxlength: [200, 'Title cannot exceed 200 characters']
    },
    description: {
        type: String,
        required: [true, 'Please provide a description'],
        maxlength: [2000, 'Description cannot exceed 2000 characters']
    },
    category: {
        type: String,
        enum: ['electrical', 'plumbing', 'structural', 'water', 'security', 'cleaning', 'internet', 'other'],
        default: 'other'
    },
    priority: {
        type: String,
        enum: ['low', 'medium', 'high', 'urgent'],
        default: 'medium'
    },
    status: {
        type: String,
        enum: ['review', 'started', 'inprogress', 'completed', 'cancelled'],
        default: 'review'
    },
    reporter: {
        type: mongoose.Schema.ObjectId,
        ref: 'User',
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
    tenant: {
        type: mongoose.Schema.ObjectId,
        ref: 'Tenant'
    },
    assignedTo: {
        type: mongoose.Schema.ObjectId,
        ref: 'User'
    },
    // Initial media (images/videos attached at report time)
    media: [MediaSchema],
    // Audit trail: every stage change with optional proof media
    timeline: [TimelineEntrySchema],
    resolvedAt: { type: Date },
    isActive: { type: Boolean, default: true }
}, { timestamps: true });

IssueSchema.index({ reporter: 1, status: 1 });
IssueSchema.index({ estate: 1, status: 1 });
IssueSchema.index({ assignedTo: 1, status: 1 });
IssueSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Issue', IssueSchema);
