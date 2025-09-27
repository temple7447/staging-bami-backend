const mongoose = require('mongoose');

const CategorySchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a category name'],
    maxlength: [100, 'Category name cannot be more than 100 characters'],
    trim: true,
    unique: true
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot be more than 500 characters'],
    trim: true
  },
  parentCategory: {
    type: mongoose.Schema.ObjectId,
    ref: 'Category',
    default: null
  },
  level: {
    type: Number,
    default: 0, // 0 for root categories, 1 for sub-categories, 2 for sub-sub-categories (max)
    min: 0,
    max: 2, // Maximum 3 levels: 0, 1, 2
    validate: {
      validator: function(v) {
        return v >= 0 && v <= 2;
      },
      message: 'Category hierarchy cannot exceed 3 levels (parent → child → grandchild)'
    }
  },
  icon: {
    type: String,
    default: 'folder'
  },
  color: {
    type: String,
    default: '#007bff' // Default blue color
  },
  isActive: {
    type: Boolean,
    default: true
  },
  order: {
    type: Number,
    default: 0 // For custom sorting
  },
  materialCount: {
    type: Number,
    default: 0
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

// Create slug from name before saving
CategorySchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = this.name.toLowerCase().replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }
  next();
});

// Validate hierarchy depth before saving
CategorySchema.pre('save', async function(next) {
  if (this.parentCategory && this.isModified('parentCategory')) {
    const parent = await this.constructor.findById(this.parentCategory);
    if (parent) {
      if (parent.level >= 2) {
        const error = new Error('Cannot create category: Maximum hierarchy depth of 3 levels exceeded (parent → child → grandchild)');
        error.name = 'ValidationError';
        return next(error);
      }
      this.level = parent.level + 1;
    }
  } else if (!this.parentCategory) {
    this.level = 0;
  }
  next();
});

// Virtual for subcategories
CategorySchema.virtual('subcategories', {
  ref: 'Category',
  localField: '_id',
  foreignField: 'parentCategory',
  justOne: false
});

// Virtual for materials
CategorySchema.virtual('materials', {
  ref: 'Material',
  localField: '_id',
  foreignField: 'category',
  justOne: false
});

// Static method to get category tree
CategorySchema.statics.getCategoryTree = async function() {
  const categories = await this.find({ isActive: true }).sort({ order: 1, name: 1 });
  
  const buildTree = (parentId = null, level = 0) => {
    return categories
      .filter(cat => String(cat.parentCategory) === String(parentId))
      .map(cat => ({
        ...cat.toObject(),
        level,
        subcategories: buildTree(cat._id, level + 1)
      }));
  };
  
  return buildTree();
};

// Instance method to get all subcategory IDs (recursive)
CategorySchema.methods.getAllSubcategoryIds = async function() {
  const Category = this.constructor;
  const subcategories = await Category.find({ parentCategory: this._id, isActive: true });
  
  let allIds = [this._id];
  
  for (const subcategory of subcategories) {
    const subIds = await subcategory.getAllSubcategoryIds();
    allIds = allIds.concat(subIds);
  }
  
  return allIds;
};

// Update material count when materials are added/removed
CategorySchema.methods.updateMaterialCount = async function() {
  const Material = mongoose.model('Material');
  const count = await Material.countDocuments({ category: this._id, isActive: true });
  this.materialCount = count;
  await this.save();
};

// Pre-remove middleware to handle cascading deletions
CategorySchema.pre('remove', async function(next) {
  // Move subcategories to parent or root level
  await this.constructor.updateMany(
    { parentCategory: this._id },
    { parentCategory: this.parentCategory }
  );
  
  // Update materials to have no category
  const Material = mongoose.model('Material');
  await Material.updateMany(
    { category: this._id },
    { category: null }
  );
  
  next();
});

module.exports = mongoose.model('Category', CategorySchema);