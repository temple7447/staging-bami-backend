const { validationResult } = require('express-validator');
const Folder = require('../models/Folder');
const Material = require('../models/Material');

// @desc    Get all folders with hierarchical structure
// @route   GET /api/folders
// @access  Private
const getFolders = async (req, res, next) => {
  try {
    const { 
      flat = false, 
      parent = null, 
      level = null,
      includeStats = false,
      view = 'tree' // tree, flat, dropdown
    } = req.query;
    
    if (view === 'dropdown' || flat === 'true') {
      // Return flat list for dropdowns
      const folders = await Folder.getFlatFolderList();
      
      return res.status(200).json({
        success: true,
        count: folders.length,
        data: folders,
        view: 'flat'
      });
    }
    
    if (parent !== null) {
      // Get folders for specific parent
      const folders = await Folder.find({ 
        isActive: true,
        parentFolder: parent === 'null' ? null : parent
      })
      .populate('createdBy', 'name email')
      .populate('parentFolder', 'name slug fullPath')
      .sort({ order: 1, name: 1 });

      return res.status(200).json({
        success: true,
        count: folders.length,
        data: folders,
        view: 'parent-specific'
      });
    }

    if (level !== null) {
      // Get folders at specific level
      const folders = await Folder.find({ 
        isActive: true,
        level: parseInt(level)
      })
      .populate('createdBy', 'name email')
      .populate('parentFolder', 'name slug fullPath')
      .sort({ order: 1, name: 1 });

      return res.status(200).json({
        success: true,
        count: folders.length,
        data: folders,
        view: 'level-specific'
      });
    }

    // Return hierarchical tree (default)
    const folderTree = await Folder.getFolderTree();

    // Add statistics if requested
    if (includeStats === 'true') {
      for (let folder of folderTree) {
        await addFolderStats(folder);
      }
    }

    res.status(200).json({
      success: true,
      count: folderTree.length,
      data: folderTree,
      view: 'tree'
    });
  } catch (error) {
    console.error('Get folders error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching folders'
    });
  }
};

// Helper function to add statistics to folder
const addFolderStats = async (folder) => {
  if (folder.level === 2) {
    await folder.updateStats();
  }
  
  if (folder.subfolders && folder.subfolders.length > 0) {
    for (let subfolder of folder.subfolders) {
      await addFolderStats(subfolder);
    }
  }
};

// @desc    Get single folder
// @route   GET /api/folders/:id
// @access  Private
const getFolder = async (req, res, next) => {
  try {
    const { includeStats = false, includeMaterials = false } = req.query;
    
    let folder = await Folder.findById(req.params.id)
      .populate('createdBy', 'name email')
      .populate('updatedBy', 'name email')
      .populate('parentFolder', 'name slug fullPath level');

    if (!folder || !folder.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    // Get folder path/breadcrumbs
    const folderPath = await folder.getFolderPath();
    
    // Get subfolders
    const subfolders = await Folder.find({ 
      parentFolder: folder._id,
      isActive: true 
    })
    .sort({ order: 1, name: 1 });

    const result = {
      ...folder.toObject(),
      folderPath,
      subfolders,
      canHaveSubfolders: folder.canHaveSubfolders,
      canHaveMaterials: folder.canHaveMaterials,
      folderType: folder.folderType
    };

    // Include statistics if requested
    if (includeStats === 'true') {
      if (folder.level === 2) {
        await folder.updateStats();
        result.materialCount = folder.materialCount;
        result.totalSize = folder.totalSize;
      }
    }

    // Include materials if requested and folder can have materials
    if (includeMaterials === 'true' && folder.level === 2) {
      const materials = await Material.find({
        folder: folder._id,
        isActive: true,
        status: 'active'
      })
      .select('title slug fileType fileSize createdAt viewCount downloadCount')
      .sort({ createdAt: -1 });
      
      result.materials = materials;
    }

    res.status(200).json({
      success: true,
      data: result
    });
  } catch (error) {
    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }
    
    console.error('Get folder error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching folder'
    });
  }
};

// @desc    Create new folder
// @route   POST /api/folders
// @access  Private
const createFolder = async (req, res, next) => {
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

    const { 
      name, 
      description, 
      parentFolder, 
      icon = 'folder', 
      color = '#6C757D',
      order = 0,
      visibility = 'public',
      allowedRoles = [],
      allowMaterials = true,
      isProtected = false
    } = req.body;

    // Check if folder name already exists within the same parent
    const existingFolder = await Folder.findOne({ 
      name: new RegExp(`^${name}$`, 'i'),
      parentFolder: parentFolder || null,
      isActive: true 
    });

    if (existingFolder) {
      return res.status(400).json({
        success: false,
        message: 'Folder with this name already exists in the same location'
      });
    }

    // Validate parent folder exists and check hierarchy rules
    let level = 0;
    if (parentFolder) {
      const parent = await Folder.findById(parentFolder);
      if (!parent || !parent.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Parent folder not found'
        });
      }
      
      // Check if parent can have subfolders
      if (!parent.canHaveSubfolders) {
        return res.status(400).json({
          success: false,
          message: 'Parent folder cannot contain subfolders (maximum depth reached)'
        });
      }
      
      level = parent.level + 1;
    }

    // For grandchild folders (level 2), ensure allowMaterials is true by default
    if (level === 2 && allowMaterials === undefined) {
      allowMaterials = true;
    }

    const folder = await Folder.create({
      name,
      description,
      parentFolder: parentFolder || null,
      level,
      icon,
      color,
      order,
      visibility,
      allowedRoles: Array.isArray(allowedRoles) ? allowedRoles : [],
      allowMaterials,
      isProtected,
      createdBy: req.user.id
    });

    const populatedFolder = await Folder.findById(folder._id)
      .populate('createdBy', 'name email')
      .populate('parentFolder', 'name slug fullPath level');

    res.status(201).json({
      success: true,
      message: 'Folder created successfully',
      data: {
        ...populatedFolder.toObject(),
        folderType: populatedFolder.folderType,
        canHaveSubfolders: populatedFolder.canHaveSubfolders,
        canHaveMaterials: populatedFolder.canHaveMaterials
      }
    });
  } catch (error) {
    console.error('Create folder error:', error);
    
    // Handle duplicate key error
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Folder with this name already exists in the same location'
      });
    }

    // Handle validation errors
    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error occurred while creating folder'
    });
  }
};

// @desc    Update folder
// @route   PUT /api/folders/:id
// @access  Private
const updateFolder = async (req, res, next) => {
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

    let folder = await Folder.findById(req.params.id);

    if (!folder || !folder.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    const { 
      name, 
      description, 
      parentFolder, 
      icon, 
      color, 
      order,
      visibility,
      allowedRoles,
      allowMaterials,
      isProtected
    } = req.body;

    // Check if new name already exists (excluding current folder)
    if (name && name !== folder.name) {
      const existingFolder = await Folder.findOne({ 
        name: new RegExp(`^${name}$`, 'i'),
        parentFolder: parentFolder !== undefined ? (parentFolder || null) : folder.parentFolder,
        _id: { $ne: folder._id },
        isActive: true 
      });

      if (existingFolder) {
        return res.status(400).json({
          success: false,
          message: 'Folder with this name already exists in the same location'
        });
      }
    }

    // Validate parent folder if changing
    if (parentFolder !== undefined) {
      if (parentFolder === null) {
        // Moving to root level
      } else {
        // Check if trying to set itself or its descendant as parent
        if (parentFolder === req.params.id) {
          return res.status(400).json({
            success: false,
            message: 'Folder cannot be its own parent'
          });
        }

        const parent = await Folder.findById(parentFolder);
        if (!parent || !parent.isActive) {
          return res.status(400).json({
            success: false,
            message: 'Parent folder not found'
          });
        }

        // Check if the parent can have subfolders
        if (!parent.canHaveSubfolders) {
          return res.status(400).json({
            success: false,
            message: 'Parent folder cannot contain subfolders (maximum depth reached)'
          });
        }

        // Check if the parent is a descendant of current folder
        const descendantIds = await folder.getAllDescendantIds();
        if (descendantIds.includes(parentFolder)) {
          return res.status(400).json({
            success: false,
            message: 'Cannot set a descendant folder as parent'
          });
        }
      }
    }

    // Update folder
    const updateData = {
      updatedBy: req.user.id
    };

    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (parentFolder !== undefined) updateData.parentFolder = parentFolder || null;
    if (icon !== undefined) updateData.icon = icon;
    if (color !== undefined) updateData.color = color;
    if (order !== undefined) updateData.order = parseInt(order) || 0;
    if (visibility !== undefined) updateData.visibility = visibility;
    if (allowedRoles !== undefined) updateData.allowedRoles = Array.isArray(allowedRoles) ? allowedRoles : [];
    if (allowMaterials !== undefined) updateData.allowMaterials = allowMaterials;
    if (isProtected !== undefined) updateData.isProtected = isProtected;

    folder = await Folder.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true, runValidators: true }
    )
    .populate('createdBy', 'name email')
    .populate('updatedBy', 'name email')
    .populate('parentFolder', 'name slug fullPath level');

    res.status(200).json({
      success: true,
      message: 'Folder updated successfully',
      data: {
        ...folder.toObject(),
        folderType: folder.folderType,
        canHaveSubfolders: folder.canHaveSubfolders,
        canHaveMaterials: folder.canHaveMaterials
      }
    });
  } catch (error) {
    console.error('Update folder error:', error);

    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Folder with this name already exists in the same location'
      });
    }

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error occurred while updating folder'
    });
  }
};

// @desc    Delete folder
// @route   DELETE /api/folders/:id
// @access  Private
const deleteFolder = async (req, res, next) => {
  try {
    const folder = await Folder.findById(req.params.id);

    if (!folder || !folder.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    // Check if folder can be deleted
    const deletionCheck = await folder.canBeDeleted();
    if (!deletionCheck.canDelete) {
      return res.status(400).json({
        success: false,
        message: `Cannot delete folder: ${deletionCheck.reason}`
      });
    }

    // Soft delete - set isActive to false
    await Folder.findByIdAndUpdate(req.params.id, { 
      isActive: false,
      updatedBy: req.user.id
    });

    // Update parent's subfolder count
    if (folder.parentFolder) {
      await Folder.updateSubfolderCount(folder.parentFolder);
    }

    res.status(200).json({
      success: true,
      message: 'Folder deleted successfully'
    });
  } catch (error) {
    console.error('Delete folder error:', error);

    if (error.name === 'CastError') {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error occurred while deleting folder'
    });
  }
};

// @desc    Move folder to different parent
// @route   PUT /api/folders/:id/move
// @access  Private
const moveFolder = async (req, res, next) => {
  try {
    const { targetParentId } = req.body;

    const folder = await Folder.findById(req.params.id);
    if (!folder || !folder.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Folder not found'
      });
    }

    // Validate target parent
    if (targetParentId) {
      if (targetParentId === req.params.id) {
        return res.status(400).json({
          success: false,
          message: 'Folder cannot be moved to itself'
        });
      }

      const targetParent = await Folder.findById(targetParentId);
      if (!targetParent || !targetParent.isActive) {
        return res.status(400).json({
          success: false,
          message: 'Target parent folder not found'
        });
      }

      if (!targetParent.canHaveSubfolders) {
        return res.status(400).json({
          success: false,
          message: 'Target parent folder cannot contain subfolders'
        });
      }

      // Check for circular reference
      const descendantIds = await folder.getAllDescendantIds();
      if (descendantIds.includes(targetParentId)) {
        return res.status(400).json({
          success: false,
          message: 'Cannot move folder to one of its descendants'
        });
      }

      // Check name conflict in target location
      const nameConflict = await Folder.findOne({
        name: folder.name,
        parentFolder: targetParentId,
        _id: { $ne: folder._id },
        isActive: true
      });

      if (nameConflict) {
        return res.status(400).json({
          success: false,
          message: 'A folder with this name already exists in the target location'
        });
      }
    }

    const oldParent = folder.parentFolder;

    // Update folder's parent
    folder.parentFolder = targetParentId || null;
    folder.updatedBy = req.user.id;
    await folder.save();

    // Update subfolder counts
    if (oldParent) {
      await Folder.updateSubfolderCount(oldParent);
    }
    if (targetParentId) {
      await Folder.updateSubfolderCount(targetParentId);
    }

    const updatedFolder = await Folder.findById(req.params.id)
      .populate('parentFolder', 'name slug fullPath level');

    res.status(200).json({
      success: true,
      message: 'Folder moved successfully',
      data: updatedFolder
    });
  } catch (error) {
    console.error('Move folder error:', error);

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error occurred while moving folder'
    });
  }
};

// @desc    Get folder statistics
// @route   GET /api/folders/stats
// @access  Private
const getFolderStats = async (req, res, next) => {
  try {
    const totalFolders = await Folder.countDocuments({ isActive: true });
    const totalMaterials = await Material.countDocuments({ isActive: true, status: 'active' });

    // Get folder distribution by level
    const levelStats = await Folder.aggregate([
      { $match: { isActive: true } },
      {
        $group: {
          _id: '$level',
          count: { $sum: 1 }
        }
      },
      { $sort: { _id: 1 } }
    ]);

    // Get folders with material counts
    const folderMaterialStats = await Folder.aggregate([
      { $match: { isActive: true, level: 2 } }, // Only grandchild folders can have materials
      {
        $lookup: {
          from: 'materials',
          localField: '_id',
          foreignField: 'folder',
          as: 'materials',
          pipeline: [
            { $match: { isActive: true, status: 'active' } }
          ]
        }
      },
      {
        $addFields: {
          materialCount: { $size: '$materials' },
          totalSize: { $sum: '$materials.fileSize' }
        }
      },
      {
        $project: {
          name: 1,
          fullPath: 1,
          materialCount: 1,
          totalSize: 1
        }
      },
      { $sort: { materialCount: -1 } },
      { $limit: 10 }
    ]);

    res.status(200).json({
      success: true,
      data: {
        overview: {
          totalFolders,
          totalMaterials,
          parentFolders: levelStats.find(s => s._id === 0)?.count || 0,
          childFolders: levelStats.find(s => s._id === 1)?.count || 0,
          grandchildFolders: levelStats.find(s => s._id === 2)?.count || 0
        },
        levelDistribution: levelStats,
        topFolders: folderMaterialStats
      }
    });
  } catch (error) {
    console.error('Get folder stats error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching folder statistics'
    });
  }
};

// @desc    Get folders that can have materials (grandchild folders only)
// @route   GET /api/folders/for-materials
// @access  Private
const getFoldersForMaterials = async (req, res, next) => {
  try {
    const folders = await Folder.find({ 
      isActive: true,
      level: 2, // Only grandchild folders
      allowMaterials: true
    })
    .populate('parentFolder', 'name slug')
    .sort({ fullPath: 1, name: 1 });

    const foldersWithPath = folders.map(folder => ({
      _id: folder._id,
      name: folder.name,
      fullPath: folder.fullPath,
      displayName: folder.fullPath,
      level: folder.level,
      materialCount: folder.materialCount,
      color: folder.color,
      icon: folder.icon
    }));

    res.status(200).json({
      success: true,
      count: foldersWithPath.length,
      data: foldersWithPath
    });
  } catch (error) {
    console.error('Get folders for materials error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching folders for materials'
    });
  }
};

// @desc    Create parent folder (Level 0)
// @route   POST /api/folders/parent
// @access  Private
const createParentFolder = async (req, res, next) => {
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

    const { 
      name, 
      description, 
      icon = 'folder', 
      color = '#6C757D',
      order = 0,
      visibility = 'public',
      allowedRoles = [],
      isProtected = false
    } = req.body;

    // Check if parent folder name already exists at root level
    const existingFolder = await Folder.findOne({ 
      name: new RegExp(`^${name}$`, 'i'),
      parentFolder: null, // Root level
      isActive: true 
    });

    if (existingFolder) {
      return res.status(400).json({
        success: false,
        message: 'Parent folder with this name already exists'
      });
    }

    const folder = await Folder.create({
      name,
      description,
      parentFolder: null, // Always null for parent folders
      level: 0, // Always 0 for parent folders
      icon,
      color,
      order,
      visibility,
      allowedRoles: Array.isArray(allowedRoles) ? allowedRoles : [],
      allowMaterials: false, // Parent folders cannot have materials
      isProtected,
      createdBy: req.user.id
    });

    const populatedFolder = await Folder.findById(folder._id)
      .populate('createdBy', 'name email');

    res.status(201).json({
      success: true,
      message: 'Parent folder created successfully',
      data: {
        ...populatedFolder.toObject(),
        folderType: 'parent',
        canHaveSubfolders: true,
        canHaveMaterials: false
      }
    });
  } catch (error) {
    console.error('Create parent folder error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Parent folder with this name already exists'
      });
    }

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error occurred while creating parent folder'
    });
  }
};

// @desc    Create child folder (Level 1)
// @route   POST /api/folders/child
// @access  Private
const createChildFolder = async (req, res, next) => {
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

    const { 
      name, 
      description, 
      parentFolder, // Required for child folders
      icon = 'folder', 
      color = '#6C757D',
      order = 0,
      visibility = 'public',
      allowedRoles = [],
      isProtected = false
    } = req.body;

    if (!parentFolder) {
      return res.status(400).json({
        success: false,
        message: 'Parent folder is required for child folders'
      });
    }

    // Validate parent folder exists and is a parent folder (level 0)
    const parent = await Folder.findById(parentFolder);
    if (!parent || !parent.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Parent folder not found'
      });
    }

    if (parent.level !== 0) {
      return res.status(400).json({
        success: false,
        message: 'Child folders can only be created under parent folders (level 0)'
      });
    }

    // Check if child folder name already exists within the same parent
    const existingFolder = await Folder.findOne({ 
      name: new RegExp(`^${name}$`, 'i'),
      parentFolder: parentFolder,
      isActive: true 
    });

    if (existingFolder) {
      return res.status(400).json({
        success: false,
        message: 'Child folder with this name already exists in this parent folder'
      });
    }

    const folder = await Folder.create({
      name,
      description,
      parentFolder,
      level: 1, // Always 1 for child folders
      icon,
      color,
      order,
      visibility,
      allowedRoles: Array.isArray(allowedRoles) ? allowedRoles : [],
      allowMaterials: false, // Child folders cannot have materials
      isProtected,
      createdBy: req.user.id
    });

    const populatedFolder = await Folder.findById(folder._id)
      .populate('createdBy', 'name email')
      .populate('parentFolder', 'name slug fullPath level');

    res.status(201).json({
      success: true,
      message: 'Child folder created successfully',
      data: {
        ...populatedFolder.toObject(),
        folderType: 'child',
        canHaveSubfolders: true,
        canHaveMaterials: false
      }
    });
  } catch (error) {
    console.error('Create child folder error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Child folder with this name already exists in this parent folder'
      });
    }

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error occurred while creating child folder'
    });
  }
};

// @desc    Create grandchild folder (Level 2) - Can contain materials
// @route   POST /api/folders/grandchild
// @access  Private
const createGrandchildFolder = async (req, res, next) => {
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

    const { 
      name, 
      description, 
      parentFolder, // Required - must be a child folder
      icon = 'folder', 
      color = '#6C757D',
      order = 0,
      visibility = 'public',
      allowedRoles = [],
      allowMaterials = true, // Grandchild folders can have materials by default
      isProtected = false
    } = req.body;

    if (!parentFolder) {
      return res.status(400).json({
        success: false,
        message: 'Parent folder is required for grandchild folders'
      });
    }

    // Validate parent folder exists and is a child folder (level 1)
    const parent = await Folder.findById(parentFolder);
    if (!parent || !parent.isActive) {
      return res.status(400).json({
        success: false,
        message: 'Parent folder not found'
      });
    }

    if (parent.level !== 1) {
      return res.status(400).json({
        success: false,
        message: 'Grandchild folders can only be created under child folders (level 1)'
      });
    }

    // Check if grandchild folder name already exists within the same parent
    const existingFolder = await Folder.findOne({ 
      name: new RegExp(`^${name}$`, 'i'),
      parentFolder: parentFolder,
      isActive: true 
    });

    if (existingFolder) {
      return res.status(400).json({
        success: false,
        message: 'Grandchild folder with this name already exists in this child folder'
      });
    }

    const folder = await Folder.create({
      name,
      description,
      parentFolder,
      level: 2, // Always 2 for grandchild folders
      icon,
      color,
      order,
      visibility,
      allowedRoles: Array.isArray(allowedRoles) ? allowedRoles : [],
      allowMaterials, // Grandchild folders can have materials
      isProtected,
      createdBy: req.user.id
    });

    const populatedFolder = await Folder.findById(folder._id)
      .populate('createdBy', 'name email')
      .populate('parentFolder', 'name slug fullPath level');

    res.status(201).json({
      success: true,
      message: 'Grandchild folder created successfully (can now contain materials)',
      data: {
        ...populatedFolder.toObject(),
        folderType: 'grandchild',
        canHaveSubfolders: false,
        canHaveMaterials: true
      }
    });
  } catch (error) {
    console.error('Create grandchild folder error:', error);
    
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: 'Grandchild folder with this name already exists in this child folder'
      });
    }

    if (error.name === 'ValidationError') {
      return res.status(400).json({
        success: false,
        message: error.message
      });
    }

    res.status(500).json({
      success: false,
      message: 'Server error occurred while creating grandchild folder'
    });
  }
};

module.exports = {
  getFolders,
  getFolder,
  createFolder,
  createParentFolder,
  createChildFolder,
  createGrandchildFolder,
  updateFolder,
  deleteFolder,
  moveFolder,
  getFolderStats,
  getFoldersForMaterials
};
