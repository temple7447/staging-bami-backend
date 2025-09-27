const mongoose = require('mongoose');

const FolderSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a folder name'],
    maxlength: [100, 'Folder name cannot be more than 100 characters'],
    trim: true
  },
  slug: {
    type: String,
    lowercase: true
  },
  description: {
    type: String,
    maxlength: [500, 'Description cannot be more than 500 characters'],
    trim: true
  },
  
  // Hierarchical structure - Google Drive like
  parentFolder: {
    type: mongoose.Schema.ObjectId,
    ref: 'Folder',
    default: null
  },
  
  // Level tracking: 0 = root/parent, 1 = child, 2 = grandchild (max)
  level: {
    type: Number,
    default: 0,
    min: 0,
    max: 2, // Maximum 3 levels: 0, 1, 2
    validate: {
      validator: function(v) {
        return v >= 0 && v <= 2;
      },
      message: 'Folder hierarchy cannot exceed 3 levels (parent → child → grandchild)'
    }
  },
  
  // Full path for easy navigation (e.g., "Sales/Digital Marketing/Social Media")
  fullPath: {
    type: String,
    default: ''
  },
  
  // Visual customization
  icon: {
    type: String,
    default: 'folder',
    enum: ['folder', 'folder-open', 'briefcase', 'archive', 'database', 'file-text', 'layers', 'grid', 'box', 'package']
  },
  color: {
    type: String,
    default: '#6C757D', // Default gray color
    match: /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
  },
  
  // Folder status
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Ordering within the same level
  order: {
    type: Number,
    default: 0
  },
  
  // Statistics
  materialCount: {
    type: Number,
    default: 0
  },
  subfolderCount: {
    type: Number,
    default: 0
  },
  totalSize: {
    type: Number,
    default: 0 // Total size of all materials in bytes
  },
  
  // Access control
  visibility: {
    type: String,
    enum: ['public', 'managers_only', 'owner_only', 'role_specific'],
    default: 'public'
  },
  allowedRoles: [{
    type: String,
    enum: ['operations', 'marketing', 'sales', 'delivery', 'finance', 'fundraising', 'legal', 'automation', 'hr', 'leadership']
  }],
  
  // Folder properties
  isProtected: {
    type: Boolean,
    default: false // If true, folder cannot be deleted if it contains materials
  },
  allowMaterials: {
    type: Boolean,
    default: function() {
      // Only level 2 (grandchild) folders can contain materials
      return this.level === 2;
    },
    validate: {
      validator: function(v) {
        // Level 2 folders MUST allow materials, level 0 and 1 CANNOT
        if (this.level === 2) return v === true;
        if (this.level === 0 || this.level === 1) return v === false;
        return true;
      },
      message: 'Only grandchild folders (level 2) can contain materials. Parent and child folders are for organization only.'
    }
  },
  
  // Audit trail
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
FolderSchema.pre('save', function(next) {
  if (this.isModified('name')) {
    this.slug = this.name.toLowerCase()
      .replace(/[^a-zA-Z0-9]/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }
  next();
});

// Build full path before saving
FolderSchema.pre('save', async function(next) {
  if (this.isModified('name') || this.isModified('parentFolder')) {
    if (this.parentFolder) {
      const parent = await this.constructor.findById(this.parentFolder);
      if (parent) {
        this.fullPath = parent.fullPath ? `${parent.fullPath}/${this.name}` : this.name;
        this.level = parent.level + 1;
      }
    } else {
      this.fullPath = this.name;
      this.level = 0;
    }
  }
  next();
});

// Validate hierarchy depth and enforce folder rules before saving
FolderSchema.pre('save', async function(next) {
  // Check if trying to create a folder under a grandchild folder (level 2)
  if (this.parentFolder && this.isModified('parentFolder')) {
    const parent = await this.constructor.findById(this.parentFolder);
    if (parent) {
      if (parent.level >= 2) {
        const error = new Error('Cannot create folder: Grandchild folders (level 2) cannot contain subfolders. They can only store materials.');
        error.name = 'ValidationError';
        return next(error);
      }
      
      // Check if trying to set a descendant as parent (prevent circular references)
      const descendants = await this.getAllDescendantIds();
      if (descendants.includes(this.parentFolder.toString())) {
        const error = new Error('Cannot set a descendant folder as parent (circular reference)');
        error.name = 'ValidationError';
        return next(error);
      }
    }
  }
  
  // Automatically set allowMaterials based on level
  if (this.isModified('level') || this.isNew) {
    if (this.level === 2) {
      this.allowMaterials = true;  // Grandchild folders MUST allow materials
    } else {
      this.allowMaterials = false; // Parent and child folders CANNOT allow materials
    }
  }
  
  next();
});

// Update parent's subfolder count after save
FolderSchema.post('save', async function() {
  if (this.parentFolder) {
    await this.constructor.updateSubfolderCount(this.parentFolder);
  }
});

// Virtual for subfolders
FolderSchema.virtual('subfolders', {
  ref: 'Folder',
  localField: '_id',
  foreignField: 'parentFolder',
  justOne: false
});

// Virtual for materials
FolderSchema.virtual('materials', {
  ref: 'Material',
  localField: '_id',
  foreignField: 'folder',
  justOne: false
});

// Virtual for breadcrumb path
FolderSchema.virtual('breadcrumbs').get(function() {
  if (!this.fullPath) return [{ name: this.name, _id: this._id }];
  
  const pathParts = this.fullPath.split('/');
  return pathParts.map((part, index) => ({
    name: part,
    level: index
  }));
});

// Virtual for folder type based on level
FolderSchema.virtual('folderType').get(function() {
  switch (this.level) {
    case 0: return 'parent';
    case 1: return 'child';
    case 2: return 'grandchild';
    default: return 'unknown';
  }
});

// Virtual for canHaveSubfolders
FolderSchema.virtual('canHaveSubfolders').get(function() {
  return this.level < 2; // Only parent (0) and child (1) can have subfolders
});

// Virtual for canHaveMaterials - materials can only be in grandchild (level 2) folders
FolderSchema.virtual('canHaveMaterials').get(function() {
  return this.level === 2 && this.allowMaterials;
});

// Static method to get folder tree with hierarchy
FolderSchema.statics.getFolderTree = async function(parentId = null, maxDepth = 3) {
  const folders = await this.find({ 
    isActive: true,
    parentFolder: parentId
  })
  .populate('createdBy', 'name email')
  .sort({ order: 1, name: 1 });
  
  const buildTree = async (folders, currentDepth = 0) => {
    if (currentDepth >= maxDepth) return [];
    
    const result = [];
    for (const folder of folders) {
      const folderObj = folder.toObject();
      folderObj.subfolders = await this.getFolderTree(folder._id, maxDepth);
      folderObj.depth = currentDepth;
      result.push(folderObj);
    }
    return result;
  };
  
  return await buildTree(folders);
};

// Static method to get flat folder list with indentation
FolderSchema.statics.getFlatFolderList = async function() {
  const allFolders = await this.find({ isActive: true })
    .populate('parentFolder', 'name fullPath')
    .sort({ fullPath: 1, order: 1, name: 1 });
  
  return allFolders.map(folder => ({
    ...folder.toObject(),
    indentLevel: folder.level,
    displayName: '  '.repeat(folder.level) + folder.name
  }));
};

// Instance method to get all descendant folder IDs (for circular reference prevention)
FolderSchema.methods.getAllDescendantIds = async function() {
  const descendants = await this.constructor.find({ 
    parentFolder: this._id,
    isActive: true 
  });
  
  let allIds = [this._id.toString()];
  
  for (const descendant of descendants) {
    const subIds = await descendant.getAllDescendantIds();
    allIds = allIds.concat(subIds);
  }
  
  return allIds;
};

// Instance method to get folder path array
FolderSchema.methods.getFolderPath = async function() {
  const path = [];
  let currentFolder = this;
  
  while (currentFolder) {
    path.unshift({
      _id: currentFolder._id,
      name: currentFolder.name,
      slug: currentFolder.slug,
      level: currentFolder.level
    });
    
    if (currentFolder.parentFolder) {
      currentFolder = await this.constructor.findById(currentFolder.parentFolder);
    } else {
      currentFolder = null;
    }
  }
  
  return path;
};

// Instance method to check if folder can be deleted
FolderSchema.methods.canBeDeleted = async function() {
  // Check if folder has materials (if it's a grandchild folder)
  if (this.level === 2) {
    const Material = mongoose.model('Material');
    const materialCount = await Material.countDocuments({ 
      folder: this._id, 
      isActive: true 
    });
    
    if (materialCount > 0 && this.isProtected) {
      return { canDelete: false, reason: `Folder contains ${materialCount} material(s) and is protected` };
    }
  }
  
  // Check if folder has subfolders
  const subfolderCount = await this.constructor.countDocuments({
    parentFolder: this._id,
    isActive: true
  });
  
  if (subfolderCount > 0) {
    return { canDelete: false, reason: `Folder contains ${subfolderCount} subfolder(s)` };
  }
  
  return { canDelete: true, reason: null };
};

// Update subfolder count
FolderSchema.statics.updateSubfolderCount = async function(folderId) {
  if (!folderId) return;
  
  const count = await this.countDocuments({
    parentFolder: folderId,
    isActive: true
  });
  
  await this.findByIdAndUpdate(folderId, { subfolderCount: count });
};

// Update material count and total size
FolderSchema.methods.updateStats = async function() {
  const Material = mongoose.model('Material');
  
  // Get material statistics
  const stats = await Material.aggregate([
    { $match: { folder: this._id, isActive: true } },
    {
      $group: {
        _id: null,
        count: { $sum: 1 },
        totalSize: { $sum: '$fileSize' }
      }
    }
  ]);
  
  const result = stats[0] || { count: 0, totalSize: 0 };
  
  this.materialCount = result.count;
  this.totalSize = result.totalSize;
  await this.save();
};

// Index for efficient queries
FolderSchema.index({ parentFolder: 1, isActive: 1 });
FolderSchema.index({ level: 1, isActive: 1 });
FolderSchema.index({ fullPath: 1 });
FolderSchema.index({ createdBy: 1 });
FolderSchema.index({ 
  name: 'text', 
  description: 'text',
  fullPath: 'text'
});

// Compound index for unique folder names within the same parent
FolderSchema.index(
  { name: 1, parentFolder: 1 }, 
  { 
    unique: true,
    partialFilterExpression: { isActive: true }
  }
);

module.exports = mongoose.model('Folder', FolderSchema);