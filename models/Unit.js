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
  // Billing configuration per unit (service charge per month)
  serviceChargeMonthly: {
    type: Number,
    default: 0,
    min: [0, 'Service charge cannot be negative']
  },
  cautionFee: {
    type: Number,
    default: 0,
    min: [0, 'Caution fee cannot be negative']
  },
  legalFee: {
    type: Number,
    default: 0,
    min: [0, 'Legal fee cannot be negative']
  },
  meterNumber: {
    type: String,
    trim: true,
    maxlength: [50, 'Meter number cannot be more than 50 characters']
  },
  description: {
    type: String,
    maxlength: [1000, 'Description cannot be more than 1000 characters']
  },
  category: {
    type: String,
    enum: ['Apartment', 'House', 'Villa', 'Office', 'Studio', 'Penthouse', 'Other'],
    default: 'Apartment'
  },
  listingType: {
    type: String,
    enum: ['Rent', 'Sale'],
    default: 'Rent'
  },
  securityDeposit: {
    type: Number,
    default: 0,
    min: [0, 'Security deposit cannot be negative']
  },
  availableDate: {
    type: Date
  },
  bedrooms: {
    type: Number,
    default: 0,
    min: [0, 'Bedrooms cannot be negative']
  },
  bathrooms: {
    type: Number,
    default: 0,
    min: [0, 'Bathrooms cannot be negative']
  },
  area: {
    type: Number,
    default: 0,
    min: [0, 'Area cannot be negative']
  },
  amenities: {
    wifi: { type: Boolean, default: false },
    pool: { type: Boolean, default: false },
    gym: { type: Boolean, default: false },
    parking: { type: Boolean, default: false },
    ac: { type: Boolean, default: false },
    security: { type: Boolean, default: false },
    petFriendly: { type: Boolean, default: false },
    balcony: { type: Boolean, default: false },
    laundry: { type: Boolean, default: false }
  },
  streetAddress: {
    type: String,
    trim: true,
    maxlength: [200, 'Street address cannot be more than 200 characters']
  },
  images: [{
    type: String
  }],
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
  lastRentIncreaseDate: {
    type: Date
  },
  basePrice2024: {
    type: Number,
    description: 'Price as of Jan 1, 2024 or creation date'
  },
  lastServiceIncreaseDate: {
    type: Date
  },
  baseServiceCharge2024: {
    type: Number,
    description: 'Service Charge as of Jan 1, 2024 or creation date'
  },
  lastCautionIncreaseDate: {
    type: Date
  },
  baseCaution2024: {
    type: Number
  },
  lastLegalIncreaseDate: {
    type: Date
  },
  baseLegal2024: {
    type: Number
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
