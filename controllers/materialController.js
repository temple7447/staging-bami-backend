const { validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const Material = require('../models/Material');
const Category = require('../models/Category');
const { getFileInfo, deleteFile, getFileMetadata } = require('../utils/fileUpload');

// @desc    Get all materials with search and filtering
// @route   GET /api/materials
// @access  Private
const getMaterials = async (req, res, next) => {
  try {
    const {
      search,
      category,
      materialType,
      relatedPortfolio,
      relatedManagerRole,
      fileType,
      expectedROI,
      timeRequirement,
      tags,
      page = 1,
      limit = 20,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = req.query;

    const query = {
      search,
      category,
      materialType,
      relatedPortfolio,
      relatedManagerRole,
      fileType,
      expectedROI,
      timeRequirement,
      tags: tags ? tags.split(',') : undefined,
      page: parseInt(page),
      limit: parseInt(limit),
      sortBy,
      sortOrder
    };

    const result = await Material.searchMaterials(query);

    res.status(200).json({
      success: true,
      data: result.materials,
      pagination: result.pagination
    });
  } catch (error) {
    console.error('Get materials error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching materials'
    });
  }
};

// @desc    Get single material
// @route   GET /api/materials/:id
// @access  Private
const getMaterial = async (req, res, next) => {
  try {
    const material = await Material.findById(req.params.id)
      .populate('category', 'name slug icon color')
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .populate('notes.user', 'name email')
      .populate('highlights.user', 'name email')
      .populate('reviews.user', 'name email');

    if (!material || !material.isActive || material.status === 'archived') {
      return res.status(404).json({
        success: false,
        message: 'Material not found'
      });
    }

    // Track view
    await material.trackAccess('view');

    // Get related materials
    const relatedMaterials = await material.getRelatedMaterials();

    res.status(200).json({
      success: true,
      data: {
        ...material.toObject(),
        relatedMaterials
      }
    });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Material not found'
      });
    }
    
    console.error('Get material error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching material'
    });
  }
};

// @desc    Upload new material
// @route   POST /api/materials
// @access  Private
const uploadMaterial = async (req, res, next) => {
  try {
    // Check validation errors
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      // Delete uploaded file if validation fails
      if (req.file) {
        deleteFile(req.file.path);
      }
      
      return res.status(400).json({
        success: false,
        message: 'Validation errors',
        errors: errors.array()
      });
    }

    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    const {
      title,
      description,
      category,
      relatedPortfolio,
      relatedManagerRole,
      materialType,
      expectedROI = 'medium',
      timeRequirement = 'medium',
      tags,
      keywords,
      pageCount,
      duration,
      visibility = 'public',
      allowedRoles,
      priority = 0
    } = req.body;

    // Validate category exists
    const categoryDoc = await Category.findById(category);
    if (!categoryDoc || !categoryDoc.isActive) {
      deleteFile(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Category not found'
      });
    }

    // Get file information
    const fileInfo = getFileInfo(req.file);
    
    // Get additional file metadata
    const metadata = await getFileMetadata(req.file.path, fileInfo.fileType);

    // Parse arrays from strings
    const parsedTags = tags ? (typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags) : [];
    const parsedKeywords = keywords ? (typeof keywords === 'string' ? keywords.split(',').map(k => k.trim()) : keywords) : [];
    const parsedAllowedRoles = allowedRoles ? (typeof allowedRoles === 'string' ? allowedRoles.split(',').map(r => r.trim()) : allowedRoles) : [];

    // Create material
    const material = await Material.create({
      title,
      description,
      ...fileInfo,
      category,
      relatedPortfolio,
      relatedManagerRole,
      materialType,
      expectedROI,
      timeRequirement,
      tags: parsedTags,
      keywords: parsedKeywords,
      pageCount: pageCount ? parseInt(pageCount) : undefined,
      duration: duration ? parseInt(duration) : undefined,
      visibility,
      allowedRoles: parsedAllowedRoles,
      priority: parseInt(priority) || 0,
      createdBy: req.user.id
    });

    // Update category material count
    await categoryDoc.updateMaterialCount();

    const populatedMaterial = await Material.findById(material._id)
      .populate('category', 'name slug icon color')
      .populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      message: 'Material uploaded successfully',
      data: populatedMaterial
    });
  } catch (error) {
    // Delete uploaded file if error occurs
    if (req.file) {
      deleteFile(req.file.path);
    }
    
    console.error('Upload material error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while uploading material'
    });
  }
};

// @desc    Update material
// @route   PUT /api/materials/:id
// @access  Private
const updateMaterial = async (req, res, next) => {
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

    let material = await Material.findById(req.params.id);

    if (!material || !material.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Material not found'
      });
    }

    const {
      title,
      description,
      category,
      relatedPortfolio,
      relatedManagerRole,
      materialType,
      expectedROI,
      timeRequirement,
      tags,
      keywords,
      pageCount,
      duration,
      visibility,
      allowedRoles,
      priority,
      status
    } = req.body;

    // Validate category if provided
    if (category && category !== material.category.toString()) {
      const categoryDoc = await Category.findById(category);
      if (!categoryDoc || !categoryDoc.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Category not found'
        });
      }
    }

    // Parse arrays from strings
    const parsedTags = tags ? (typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags) : material.tags;
    const parsedKeywords = keywords ? (typeof keywords === 'string' ? keywords.split(',').map(k => k.trim()) : keywords) : material.keywords;
    const parsedAllowedRoles = allowedRoles ? (typeof allowedRoles === 'string' ? allowedRoles.split(',').map(r => r.trim()) : allowedRoles) : material.allowedRoles;

    // Update material
    const updateData = {
      updatedBy: req.user.id
    };

    if (title) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (category) updateData.category = category;
    if (relatedPortfolio) updateData.relatedPortfolio = relatedPortfolio;
    if (relatedManagerRole) updateData.relatedManagerRole = relatedManagerRole;
    if (materialType) updateData.materialType = materialType;
    if (expectedROI) updateData.expectedROI = expectedROI;
    if (timeRequirement) updateData.timeRequirement = timeRequirement;
    if (tags !== undefined) updateData.tags = parsedTags;
    if (keywords !== undefined) updateData.keywords = parsedKeywords;
    if (pageCount !== undefined) updateData.pageCount = parseInt(pageCount) || null;
    if (duration !== undefined) updateData.duration = parseInt(duration) || null;
    if (visibility) updateData.visibility = visibility;
    if (allowedRoles !== undefined) updateData.allowedRoles = parsedAllowedRoles;
    if (priority !== undefined) updateData.priority = parseInt(priority) || 0;
    if (status) updateData.status = status;

    material = await Material.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
    .populate('category', 'name slug icon color')
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email');

    // Update category material count if category changed
    if (category && category !== material.category.toString()) {
      const oldCategory = await Category.findById(material.category);
      const newCategory = await Category.findById(category);
      if (oldCategory) await oldCategory.updateMaterialCount();
      if (newCategory) await newCategory.updateMaterialCount();
    }

    res.status(200).json({
      success: true,
      message: 'Material updated successfully',
      data: material
    });
  } catch (error) {
    console.error('Update material error:', error);

    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Material not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error occurred while updating material'
    });
  }
};

// @desc    Delete material
// @route   DELETE /api/materials/:id
// @access  Private
const deleteMaterial = async (req, res, next) => {
  try {
    const material = await Material.findById(req.params.id);

    if (!material || !material.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Material not found'
      });
    }

    // Soft delete - set isActive to false
    await Material.findByIdAndUpdate(req.params.id, { 
      isActive: false,
      status: 'archived',
      updatedBy: req.user.id
    });

    // Update category material count
    const category = await Category.findById(material.category);
    if (category) {
      await category.updateMaterialCount();
    }

    res.status(200).json({
      success: true,
      message: 'Material deleted successfully'
    });
  } catch (error) {
    console.error('Delete material error:', error);

    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Material not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error occurred while deleting material'
    });
  }
};

// @desc    Download material file
// @route   GET /api/materials/download/:filename
// @access  Private
const downloadMaterial = async (req, res, next) => {
  try {
    const { filename } = req.params;
    
    // Find material by filename for access control
    const material = await Material.findOne({ 
      fileName: filename,
      isActive: true,
      status: 'active'
    });

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Check access permissions
    // TODO: Add role-based access control here

    const filePath = path.join(__dirname, '../uploads/materials', filename);
    
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({
        success: false,
        message: 'File not found on server'
      });
    }

    // Track download
    await material.trackAccess('download');

    // Set headers for download
    res.setHeader('Content-Disposition', `attachment; filename="${material.originalFileName}"`);
    res.setHeader('Content-Type', material.mimeType);

    // Stream file to response
    const fileStream = fs.createReadStream(filePath);
    fileStream.pipe(res);
  } catch (error) {
    console.error('Download material error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while downloading file'
    });
  }
};

// @desc    Add note to material
// @route   POST /api/materials/:id/notes
// @access  Private
const addNote = async (req, res, next) => {
  try {
    const { content } = req.body;
    
    if (!content || !content.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Note content is required'
      });
    }

    const material = await Material.findById(req.params.id);

    if (!material || !material.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Material not found'
      });
    }

    await material.addNote(req.user.id, content.trim());

    const updatedMaterial = await Material.findById(req.params.id)
      .populate('notes.user', 'name email')
      .select('notes');

    res.status(201).json({
      success: true,
      message: 'Note added successfully',
      data: updatedMaterial.notes
    });
  } catch (error) {
    console.error('Add note error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while adding note'
    });
  }
};

// @desc    Add highlight to material
// @route   POST /api/materials/:id/highlights
// @access  Private
const addHighlight = async (req, res, next) => {
  try {
    const { text, page, position } = req.body;
    
    if (!text || !text.trim()) {
      return res.status(400).json({
        success: false,
        message: 'Highlight text is required'
      });
    }

    const material = await Material.findById(req.params.id);

    if (!material || !material.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Material not found'
      });
    }

    await material.addHighlight(req.user.id, text.trim(), page, position);

    const updatedMaterial = await Material.findById(req.params.id)
      .populate('highlights.user', 'name email')
      .select('highlights');

    res.status(201).json({
      success: true,
      message: 'Highlight added successfully',
      data: updatedMaterial.highlights
    });
  } catch (error) {
    console.error('Add highlight error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while adding highlight'
    });
  }
};

// @desc    Add review to material
// @route   POST /api/materials/:id/reviews
// @access  Private
const addReview = async (req, res, next) => {
  try {
    const { rating, comment } = req.body;
    
    if (!rating || rating < 1 || rating > 5) {
      return res.status(400).json({
        success: false,
        message: 'Rating must be between 1 and 5'
      });
    }

    const material = await Material.findById(req.params.id);

    if (!material || !material.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Material not found'
      });
    }

    await material.addReview(req.user.id, parseInt(rating), comment);

    const updatedMaterial = await Material.findById(req.params.id)
      .populate('reviews.user', 'name email')
      .select('reviews averageRating ratingCount');

    res.status(201).json({
      success: true,
      message: 'Review added successfully',
      data: {
        reviews: updatedMaterial.reviews,
        averageRating: updatedMaterial.averageRating,
        ratingCount: updatedMaterial.ratingCount
      }
    });
  } catch (error) {
    console.error('Add review error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while adding review'
    });
  }
};

// @desc    Get material statistics
// @route   GET /api/materials/stats
// @access  Private
const getMaterialStats = async (req, res, next) => {
  try {
    const stats = await Material.aggregate([
      { $match: { isActive: true, status: 'active' } },
      {
        $group: {
          _id: null,
          totalMaterials: { $sum: 1 },
          totalViews: { $sum: '$viewCount' },
          totalDownloads: { $sum: '$downloadCount' },
          avgRating: { $avg: '$averageRating' }
        }
      }
    ]);

    const typeStats = await Material.aggregate([
      { $match: { isActive: true, status: 'active' } },
      {
        $group: {
          _id: '$materialType',
          count: { $sum: 1 },
          totalViews: { $sum: '$viewCount' },
          totalDownloads: { $sum: '$downloadCount' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    const portfolioStats = await Material.aggregate([
      { $match: { isActive: true, status: 'active' } },
      {
        $group: {
          _id: '$relatedPortfolio',
          count: { $sum: 1 },
          totalViews: { $sum: '$viewCount' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    const roleStats = await Material.aggregate([
      { $match: { isActive: true, status: 'active' } },
      {
        $group: {
          _id: '$relatedManagerRole',
          count: { $sum: 1 },
          totalViews: { $sum: '$viewCount' }
        }
      },
      { $sort: { count: -1 } }
    ]);

    res.status(200).json({
      success: true,
      data: {
        overview: stats[0] || {
          totalMaterials: 0,
          totalViews: 0,
          totalDownloads: 0,
          avgRating: 0
        },
        byType: typeStats,
        byPortfolio: portfolioStats,
        byRole: roleStats
      }
    });
  } catch (error) {
    console.error('Get material stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching material statistics'
    });
  }
};

module.exports = {
  getMaterials,
  getMaterial,
  uploadMaterial,
  updateMaterial,
  deleteMaterial,
  downloadMaterial,
  addNote,
  addHighlight,
  addReview,
  getMaterialStats
};