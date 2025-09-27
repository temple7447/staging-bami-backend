const { validationResult } = require('express-validator');
const path = require('path');
const fs = require('fs');
const cloudinary = require('cloudinary').v2;

cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET,
  secure: true
});

const Material = require('../models/Material');
const Category = require('../models/Category');
const Folder = require('../models/Folder');
const { getFileInfo, deleteFile, getFileMetadata } = require('../utils/fileUpload');

// @desc    Get all materials with search and filtering
// @route   GET /api/materials
// @access  Private
const getMaterials = async (req, res, next) => {
  try {
    const {
      search,
      folder, // New folder parameter
      category, // Backward compatibility
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
      folder, // Priority over category
      category: folder ? undefined : category, // Use category only if no folder specified
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
      .populate('folder', 'name slug fullPath level icon color')
      .populate('category', 'name slug icon color') // Backward compatibility
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
// Example for mobile (React Native) FormData upload:
// const data = new FormData();
// // Option A: upload a file (PDF, docx, etc.)
// data.append('file', {
//   uri: fileUri,
//   name: 'mydoc.pdf',
//   type: 'application/pdf'
// });
// // Option B: for a remote video - send the remote URL instead of uploading a file:
// data.append('videoUrl', 'https://videos.example.com/path/to/video.mp4');
// data.append('title', 'Intro to Product Strategy');
// data.append('category', '60f7c5e1abcd1234abcd1234');
// data.append('materialType', 'video'); // use "video" and supply videoUrl
// fetch('https://your-api.example.com/api/materials', {
//   method: 'POST',
//   headers: { 'Authorization': 'Bearer <JWT_TOKEN>' },
//   body: data
// });
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

    const {
      title,
      description,
      folder, // New folder field (priority)
      category, // Backward compatibility
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
      priority = 0,
      videoUrl // new optional field for remote videos
    } = req.body;

    // If materialType is video and no file AND no videoUrl provided => error
    if (materialType === 'video' && !req.file && !videoUrl) {
      return res.status(400).json({
        success: false,
        message: 'Video materials require either an uploaded file or a videoUrl'
      });
    }

    // If both uploaded file and videoUrl are present, prefer videoUrl and remove temp file
    if (materialType === 'video' && videoUrl && req.file) {
      // remove uploaded temp file
      deleteFile(req.file.path);
      req.file = undefined;
    }

    // If still no file and materialType is not video -> require file
    if (!req.file && materialType !== 'video') {
      return res.status(400).json({
        success: false,
        message: 'No file uploaded'
      });
    }

    // Validate folder or category exists
    let folderDoc, categoryDoc;
    
    if (folder) {
      folderDoc = await Folder.findById(folder);
      if (!folderDoc || !folderDoc.isActive) {
        if (req.file) deleteFile(req.file.path);
        return res.status(400).json({
          success: false,
          message: 'Folder not found'
        });
      }
      
      // Materials can only be placed in grandchild folders (level 2)
      if (folderDoc.level !== 2) {
        if (req.file) deleteFile(req.file.path);
        return res.status(400).json({
          success: false,
          message: 'Materials can only be placed in the deepest level folders (grandchild folders)'
        });
      }
      
      if (!folderDoc.allowMaterials) {
        if (req.file) deleteFile(req.file.path);
        return res.status(400).json({
          success: false,
          message: 'This folder does not allow materials'
        });
      }
    } else if (category) {
      // Backward compatibility for category
      categoryDoc = await Category.findById(category);
      if (!categoryDoc || !categoryDoc.isActive) {
        if (req.file) deleteFile(req.file.path);
        return res.status(400).json({
          success: false,
          message: 'Category not found'
        });
      }
    } else {
      if (req.file) deleteFile(req.file.path);
      return res.status(400).json({
        success: false,
        message: 'Either folder or category is required'
      });
    }

    let fileInfo = {};
    let uploadResult = null;

    if (req.file) {
      // Get file information (local/multer metadata)
      fileInfo = getFileInfo(req.file);
      
      // Optionally get additional metadata (e.g. PDF pages)
      const metadata = await getFileMetadata(req.file.path, fileInfo.fileType);

      // Upload file to Cloudinary (resource_type 'auto')
      try {
        uploadResult = await cloudinary.uploader.upload(req.file.path, {
          resource_type: 'auto',
          folder: 'materials',
          use_filename: true,
          unique_filename: false,
          overwrite: false
        });
      } catch (uploadErr) {
        // Remove local temp file before returning
        if (req.file) deleteFile(req.file.path);
        console.error('Cloudinary upload error:', uploadErr);
        return res.status(500).json({
          success: false,
          message: 'File upload to Cloudinary failed'
        });
      }

      // Delete local temp file after successful upload
      if (req.file) deleteFile(req.file.path);
    }

    // Parse arrays from strings
    const parsedTags = tags ? (typeof tags === 'string' ? tags.split(',').map(t => t.trim()) : tags) : [];
    const parsedKeywords = keywords ? (typeof keywords === 'string' ? keywords.split(',').map(k => k.trim()) : keywords) : [];
    const parsedAllowedRoles = allowedRoles ? (typeof allowedRoles === 'string' ? allowedRoles.split(',').map(r => r.trim()) : allowedRoles) : [];

    // Build create payload
    const createPayload = {
      title,
      description,
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
    };
    
    // Add folder or category (folder takes precedence)
    if (folder) {
      createPayload.folder = folder;
    } else if (category) {
      createPayload.category = category;
    }

    if (materialType === 'video' && videoUrl) {
      // Use remote video URL instead of uploaded file
      createPayload.fileUrl = videoUrl;
      createPayload.fileName = null;
      createPayload.originalFileName = null;
      createPayload.mimeType = 'video/*';
      createPayload.fileSize = undefined;
      createPayload.cloudinaryId = null;
      createPayload.cloudinaryResourceType = 'video';
      // include any fileInfo fallback if available
      Object.assign(createPayload, fileInfo);
    } else if (uploadResult) {
      // File uploaded to Cloudinary
      Object.assign(createPayload, {
        fileUrl: uploadResult.secure_url,
        fileName: uploadResult.public_id,
        originalFileName: req.file ? req.file.originalname : uploadResult.original_filename,
        mimeType: req.file ? req.file.mimetype : undefined,
        fileSize: uploadResult.bytes || (req.file ? req.file.size : undefined),
        cloudinaryId: uploadResult.public_id,
        cloudinaryResourceType: uploadResult.resource_type,
        ...fileInfo
      });
    }

    // Create material - save info
    const material = await Material.create(createPayload);

    // Update folder or category material count
    if (folderDoc) {
      await folderDoc.updateStats();
    } else if (categoryDoc) {
      await categoryDoc.updateMaterialCount();
    }

    const populatedMaterial = await Material.findById(material._id)
      .populate('folder', 'name slug fullPath level icon color')
      .populate('category', 'name slug icon color') // Backward compatibility
      .populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      message: 'Material uploaded successfully',
      data: populatedMaterial
    });
  } catch (error) {
    // Delete uploaded temp file if error occurs
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
      folder,
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

    // Validate folder if provided
    if (folder && folder !== (material.folder ? material.folder.toString() : null)) {
      const folderDoc = await Folder.findById(folder);
      if (!folderDoc || !folderDoc.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Folder not found'
        });
      }
      
      if (folderDoc.level !== 2 || !folderDoc.allowMaterials) {
        return res.status(400).json({
          success: false,
          message: 'Materials can only be moved to grandchild folders that allow materials'
        });
      }
    }
    
    // Validate category if provided (backward compatibility)
    if (category && category !== (material.category ? material.category.toString() : null)) {
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
    if (folder) updateData.folder = folder;
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
    .populate('folder', 'name slug fullPath level icon color')
    .populate('category', 'name slug icon color') // Backward compatibility
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email');

    // Update folder/category material counts if changed
    if (folder) {
      // Update old folder stats if material had a folder
      const oldMaterial = await Material.findById(req.params.id);
      if (oldMaterial.folder && oldMaterial.folder.toString() !== folder) {
        const oldFolder = await Folder.findById(oldMaterial.folder);
        if (oldFolder) await oldFolder.updateStats();
      }
      // Update new folder stats
      const newFolder = await Folder.findById(folder);
      if (newFolder) await newFolder.updateStats();
    }
    
    // Backward compatibility: Update category material count if category changed
    if (category && material.category && category !== material.category.toString()) {
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

    // Update folder or category material count
    if (material.folder) {
      const folder = await Folder.findById(material.folder);
      if (folder) {
        await folder.updateStats();
      }
    } else if (material.category) {
      const category = await Category.findById(material.category);
      if (category) {
        await category.updateMaterialCount();
      }
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
    
    // Find material by filename (either public_id or original filename)
    const material = await Material.findOne({ 
      $or: [
        { fileName: filename },
        { originalFileName: filename }
      ],
      isActive: true,
      status: 'active'
    })
    .populate('folder', 'name fullPath')
    .populate('category', 'name'); // Backward compatibility

    if (!material) {
      return res.status(404).json({
        success: false,
        message: 'File not found'
      });
    }

    // Check access permissions
    // TODO: Add role-based access control here

    // If the file is stored on Cloudinary, redirect to the secure URL
    if (material.fileUrl) {
      // Track download
      await material.trackAccess('download');
      return res.redirect(material.fileUrl);
    }

    // Fallback to local storage path (legacy)
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