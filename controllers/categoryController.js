const { validationResult } = require('express-validator');
const Category = require('../models/Category');

// @desc    Get all categories with hierarchical structure
// @route   GET /api/categories
// @access  Private
const getCategories = async (req, res, next) => {
  try {
    const { flat = false, parent = null } = req.query;
    
    if (flat === 'true') {
      // Return flat list
      const categories = await Category.find({ 
        isActive: true,
        ...(parent && { parentCategory: parent === 'null' ? null : parent })
      })
      .populate('createdBy', 'name email')
      .sort({ order: 1, name: 1 });

      return res.status(200).json({
        success: true,
        count: categories.length,
        data: categories
      });
    }

    // Return hierarchical tree
    const categoryTree = await Category.getCategoryTree();

    res.status(200).json({
      success: true,
      count: categoryTree.length,
      data: categoryTree
    });
  } catch (error) {
    console.error('Get categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching categories'
    });
  }
};

// @desc    Get single category
// @route   GET /api/categories/:id
// @access  Private
const getCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .populate('subcategories');

    if (!category || !category.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.status(200).json({
      success: true,
      data: category
    });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }
    
    console.error('Get category error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching category'
    });
  }
};

// @desc    Create new category
// @route   POST /api/categories
// @access  Private (Admin/Super Admin)
const createCategory = async (req, res, next) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    const { name, description, parentCategory, icon, color, order } = req.body;

    // Check if category name already exists
    const existingCategory = await Category.findOne({ 
      name: new RegExp(`^${name}$`, 'i'),
      isActive: true 
    });

    if (existingCategory) {
      return res.status(400).json({
        success: false,
        message: 'Category with this name already exists'
      });
    }

    // Validate parent category exists if provided
    let level = 0;
    if (parentCategory) {
      const parent = await Category.findById(parentCategory);
      if (!parent || !parent.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Parent category not found'
        });
      }
      level = parent.level + 1;
    }

    const category = await Category.create({
      name,
      description,
      parentCategory: parentCategory || null,
      level,
      icon: icon || 'folder',
      color: color || '#007bff',
      order: order || 0,
      createdBy: req.user.id
    });

    const populatedCategory = await Category.findById(category._id)
      .populate('createdBy', 'name email')
      .populate('parentCategory', 'name slug');

    res.status(201).json({
      success: true,
      message: 'Category created successfully',
      data: populatedCategory
    });
  } catch (error) {
    console.error('Create category error:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Category with this name already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error occurred while creating category'
    });
  }
};

// @desc    Update category
// @route   PUT /api/categories/:id
// @access  Private (Admin/Super Admin)
const updateCategory = async (req, res, next) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    let category = await Category.findById(req.params.id);

    if (!category || !category.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    const { name, description, parentCategory, icon, color, order } = req.body;

    // Check if new name already exists (excluding current category)
    if (name && name !== category.name) {
      const existingCategory = await Category.findOne({ 
        name: new RegExp(`^${name}$`, 'i'),
        _id: { $ne: category._id },
        isActive: true 
      });

      if (existingCategory) {
        return res.status(400).json({
          success: false,
          message: 'Category with this name already exists'
        });
      }
    }

    // Validate parent category
    let level = category.level;
    if (parentCategory !== undefined) {
      if (parentCategory === null) {
        level = 0;
      } else {
        // Check if trying to set itself or its descendant as parent
        if (parentCategory === req.params.id) {
          return res.status(400).json({
            success: false,
            message: 'Category cannot be its own parent'
          });
        }

        const parent = await Category.findById(parentCategory);
        if (!parent || !parent.isActive) {
          return res.status(400).json({
            success: false,
            message: 'Parent category not found'
          });
        }

        // Check if the parent is a descendant of current category
        const descendantIds = await category.getAllSubcategoryIds();
        if (descendantIds.includes(parentCategory)) {
          return res.status(400).json({
            success: false,
            message: 'Cannot set a descendant category as parent'
          });
        }

        level = parent.level + 1;
      }
    }

    // Update category
    const updateData = {
      updatedBy: req.user.id,
      level
    };

    if (name) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (parentCategory !== undefined) updateData.parentCategory = parentCategory;
    if (icon) updateData.icon = icon;
    if (color) updateData.color = color;
    if (order !== undefined) updateData.order = order;

    category = await Category.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email')
    .populate('parentCategory', 'name slug');

    res.status(200).json({
      success: true,
      message: 'Category updated successfully',
      data: category
    });
  } catch (error) {
    console.error('Update category error:', error);

    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Category with this name already exists'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error occurred while updating category'
    });
  }
};

// @desc    Delete category
// @route   DELETE /api/categories/:id
// @access  Private (Admin/Super Admin)
const deleteCategory = async (req, res, next) => {
  try {
    const category = await Category.findById(req.params.id);

    if (!category || !category.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Check if category has materials
    const Material = require('../models/Material');
    const materialCount = await Material.countDocuments({ 
      category: category._id, 
      isActive: true 
    });

    if (materialCount > 0) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete category. It contains ${materialCount} material(s). Please move or delete the materials first.`
      });
    }

    // Soft delete - set isActive to false
    await Category.findByIdAndUpdate(req.params.id, { 
      isActive: false,
      updatedBy: req.user.id
    });

    res.status(200).json({
      success: true,
      message: 'Category deleted successfully'
    });
  } catch (error) {
    console.error('Delete category error:', error);

    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Category not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error occurred while deleting category'
    });
  }
};

// @desc    Reorder categories
// @route   PUT /api/categories/reorder
// @access  Private (Admin/Super Admin)
const reorderCategories = async (req, res, next) => {
  try {
    const { categories } = req.body;

    if (!Array.isArray(categories)) {
      return res.status(400).json({
        success: false,
        message: 'Categories must be an array'
      });
    }

    // Update order for each category
    const updatePromises = categories.map((cat, index) => {
      return Category.findByIdAndUpdate(
        cat.id,
        { order: index, updatedBy: req.user.id },
        { new: true }
      );
    });

    await Promise.all(updatePromises);

    res.status(200).json({
      success: true,
      message: 'Categories reordered successfully'
    });
  } catch (error) {
    console.error('Reorder categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while reordering categories'
    });
  }
};

// @desc    Get category statistics
// @route   GET /api/categories/stats
// @access  Private
const getCategoryStats = async (req, res, next) => {
  try {
    const Material = require('../models/Material');
    
    const stats = await Category.aggregate([
      { $match: { isActive: true } },
      {
        $lookup: {
          from: 'materials',
          localField: '_id',
          foreignField: 'category',
          as: 'materials',
          pipeline: [
            { $match: { isActive: true, status: 'active' } }
          ]
        }
      },
      {
        $addFields: {
          materialCount: { $size: '$materials' },
          totalViews: { $sum: '$materials.viewCount' },
          totalDownloads: { $sum: '$materials.downloadCount' }
        }
      },
      {
        $project: {
          name: 1,
          slug: 1,
          level: 1,
          parentCategory: 1,
          icon: 1,
          color: 1,
          materialCount: 1,
          totalViews: 1,
          totalDownloads: 1
        }
      },
      { $sort: { materialCount: -1 } }
    ]);

    const totalCategories = await Category.countDocuments({ isActive: true });
    const totalMaterials = await Material.countDocuments({ isActive: true, status: 'active' });

    res.status(200).json({
      success: true,
      data: {
        totalCategories,
        totalMaterials,
        categories: stats
      }
    });
  } catch (error) {
    console.error('Get category stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching category statistics'
    });
  }
};

// @desc    Initialize default categories
// @route   POST /api/categories/init-defaults
// @access  Private (Super Admin only)
const initializeDefaultCategories = async (req, res, next) => {
  try {
    // Check if categories already exist
    const existingCategories = await Category.countDocuments({ isActive: true });
    
    if (existingCategories > 0) {
      return res.status(400).json({
        success: false,
        message: 'Categories already exist. Cannot initialize defaults.'
      });
    }

    const defaultCategories = [
      { name: 'Sales', icon: 'trending-up', color: '#28a745', order: 1 },
      { name: 'Marketing', icon: 'megaphone', color: '#17a2b8', order: 2 },
      { name: 'Operations', icon: 'settings', color: '#ffc107', order: 3 },
      { name: 'Finance & Accounting', icon: 'dollar-sign', color: '#dc3545', order: 4 },
      { name: 'Legal & Security', icon: 'shield', color: '#6c757d', order: 5 },
      { name: 'Hiring & HR', icon: 'users', color: '#e83e8c', order: 6 },
      { name: 'Leadership', icon: 'award', color: '#fd7e14', order: 7 },
      { name: 'Time Management & Productivity', icon: 'clock', color: '#20c997', order: 8 },
      { name: 'Automation & Systems', icon: 'cpu', color: '#6f42c1', order: 9 },
      { name: 'Customer Experience', icon: 'smile', color: '#007bff', order: 10 },
      { name: 'Investment & Portfolio Growth', icon: 'bar-chart', color: '#28a745', order: 11 },
      { name: 'Personal Development', icon: 'user-plus', color: '#17a2b8', order: 12 }
    ];

    const createdCategories = [];
    
    for (const categoryData of defaultCategories) {
      const category = await Category.create({
        ...categoryData,
        createdBy: req.user.id
      });
      createdCategories.push(category);
    }

    res.status(201).json({
      success: true,
      message: 'Default categories initialized successfully',
      data: createdCategories
    });
  } catch (error) {
    console.error('Initialize default categories error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while initializing default categories'
    });
  }
};

module.exports = {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  getCategoryStats,
  initializeDefaultCategories
};