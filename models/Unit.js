const mongoose = require('mongoose');

const UnitSchema = new mongoose.Schema({
  estate: {
    type: mongoose.Schema.ObjectId,
    ref: 'Estate',
    required: [true, 'Estate is required']
  },
  label: {
    type: String,
    required: [true, 'Unit label is required'],
    trim: true,
    maxlength: [100, 'Unit label cannot be more than 100 characters']
  },
  monthlyPrice: {
    type: Number,
    required: [true, 'Monthly price is required'],
    min: [0, 'Monthly price cannot be negative']
  },
  meterNumber: {
    type: String,
    trim: true,
    maxlength: [50, 'Meter number cannot be more than 50 characters']
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot be more than 500 characters']
  },
  status: {
    type: String,
    enum: ['vacant', 'occupied', 'maintenance', 'reserved'],
    default: 'vacant'
  },
  occupiedBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'Tenant',
    sparse: true
  },
  occupiedSince: {
    type: Date
  },
  features: [{
    name: String,
    value: String
  }],
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

// Unique unit label per estate
UnitSchema.index(
  { estate: 1, label: 1, isActive: 1 },
  { unique: true, partialFilterExpression: { isActive: true } }
);

// Index for quick lookups
UnitSchema.index({ estate: 1, status: 1 });

module.exports = mongoose.model('Unit', UnitSchema);
