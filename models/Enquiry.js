const mongoose = require('mongoose');

const EnquirySchema = new mongoose.Schema({
  estate: {
    type: mongoose.Schema.ObjectId,
    ref: 'Estate',
    required: [true, 'Estate is required']
  },
  unit: {
    type: mongoose.Schema.ObjectId,
    ref: 'Unit'
  },
  name: {
    type: String,
    required: [true, 'Name is required'],
    trim: true,
    maxlength: [150, 'Name cannot exceed 150 characters']
  },
  email: {
    type: String,
    required: [true, 'Email is required'],
    lowercase: true,
    trim: true,
    match: [/^\S+@\S+\.\S+$/, 'Please enter a valid email']
  },
  message: {
    type: String,
    required: [true, 'Message is required'],
    trim: true,
    maxlength: [2000, 'Message cannot exceed 2000 characters']
  },
  status: {
    type: String,
    enum: ['new', 'read', 'replied', 'archived'],
    default: 'new'
  },
  repliedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  repliedAt: {
    type: Date
  },
  isActive: {
    type: Boolean,
    default: true
  }
}, { timestamps: true });

EnquirySchema.index({ estate: 1, status: 1, createdAt: -1 });
EnquirySchema.index({ email: 1 });

module.exports = mongoose.model('Enquiry', EnquirySchema);
