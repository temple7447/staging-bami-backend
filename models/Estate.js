const mongoose = require('mongoose');

const EstateSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide an estate name'],
    maxlength: [150, 'Estate name cannot be more than 150 characters'],
    trim: true
  },
  slug: {
    type: String,
    lowercase: true,
    unique: true
  },
  description: {
    type: String,
    maxlength: [1000, 'Description cannot be more than 1000 characters'],
  },
  totalUnits: {
    type: Number,
    required: [true, 'Please provide total units for this estate'],
    min: [0, 'Total units cannot be negative']
  },
  // Ownership tracking
  owner: {
    type: mongoose.Schema.ObjectId,
    ref: 'User',
    required: function () {
      // Owner required if createdBy user is business_owner
      return this.createdBy && this.createdBy.role === 'business_owner';
    }
  },
  // Admins/managers who can manage this estate
  managers: [{
    type: mongoose.Schema.ObjectId,
    ref: 'User'
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
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Slug from name
EstateSchema.pre('save', function (next) {
  if (this.isModified('name')) {
    this.slug = this.name.toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  next();
});

// Ensure unique active name (case-insensitive)
EstateSchema.pre('save', async function (next) {
  if (!this.isModified('name')) return next();
  const existing = await this.constructor.findOne({
    name: new RegExp(`^${this.name}$`, 'i'),
    isActive: true,
    _id: { $ne: this._id }
  });
  if (existing) {
    const err = new Error('An estate with this name already exists');
    err.name = 'ValidationError';
    return next(err);
  }
  next();
});

// Performance indexes for common query patterns
EstateSchema.index({ name: 'text' }); // For search functionality
EstateSchema.index({ isActive: 1, createdAt: -1 });
EstateSchema.index({ owner: 1, isActive: 1 });
EstateSchema.index({ managers: 1, isActive: 1 });
EstateSchema.index({ createdAt: -1 });

module.exports = mongoose.model('Estate', EstateSchema);
