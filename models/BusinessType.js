const mongoose = require('mongoose');

const BusinessTypeSchema = new mongoose.Schema({
    name: {
        type: String,
        required: [true, 'Please provide a business type name'],
        unique: true,
        trim: true,
        maxlength: [100, 'Business type name cannot be more than 100 characters']
    },
    description: {
        type: String,
        maxlength: [500, 'Description cannot be more than 500 characters']
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

// Index for faster queries
BusinessTypeSchema.index({ isActive: 1, name: 1 });

module.exports = mongoose.model('BusinessType', BusinessTypeSchema);
