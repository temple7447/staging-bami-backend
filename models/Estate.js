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
EstateSchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = this.name.toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  next();
});

// Ensure unique active name (case-insensitive)
EstateSchema.pre('save', async function(next) {
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

module.exports = mongoose.model('Estate', EstateSchema);
