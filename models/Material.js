const mongoose = require('mongoose');

const MaterialSchema = new mongoose.Schema({
  title: {
    type: String,
    required: [true, 'Please provide a material title'],
    maxlength: [200, 'Title cannot be more than 200 characters'],
    trim: true
  },
  description: {
    type: String,
    maxlength: [1000, 'Description cannot be more than 1000 characters'],
    trim: true
  },
  slug: {
    type: String,
    unique: true,
    lowercase: true
  },
  
  // File Information
  fileName: {
    type: String,
    required: [true, 'File name is required']
  },
  originalFileName: {
    type: String,
    required: [true, 'Original file name is required']
  },
  fileSize: {
    type: Number,
    required: [true, 'File size is required']
  },
  fileType: {
    type: String,
    required: [true, 'File type is required'],
    enum: ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'mp3', 'mp4', 'wav', 'avi', 'mov', 'jpg', 'jpeg', 'png', 'gif', 'txt', 'zip', 'rar']
  },
  mimeType: {
    type: String,
    required: [true, 'MIME type is required']
  },
  filePath: {
    type: String,
    required: [true, 'File path is required']
  },
  fileUrl: {
    type: String // Public URL if using cloud storage
  },
  
  // Categorization
  category: {
    type: mongoose.Schema.ObjectId,
    ref: 'Category',
    required: [true, 'Please select a category']
  },
  
  // Portfolio Association
  relatedPortfolio: {
    type: String,
    enum: ['personal', 'business', 'estate', 'equipment', 'investments', 'other'],
    required: [true, 'Please specify related portfolio']
  },
  
  // Manager Role Association
  relatedManagerRole: {
    type: String,
    enum: ['operations', 'marketing', 'sales', 'delivery', 'finance', 'fundraising', 'legal', 'automation', 'hr', 'leadership'],
    required: [true, 'Please specify related manager role']
  },
  
  // Material Type
  materialType: {
    type: String,
    enum: ['guide', 'case_study', 'how_to', 'template', 'checklist', 'presentation', 'video_tutorial', 'audio_note', 'document', 'image', 'other'],
    required: [true, 'Please specify material type']
  },
  
  // ROI Information
  expectedROI: {
    type: String,
    enum: ['high', 'medium', 'low'],
    default: 'medium'
  },
  
  // Time Requirement
  timeRequirement: {
    type: String,
    enum: ['quick', 'medium', 'deep_study'],
    default: 'medium'
  },
  
  // Tags
  tags: [{
    type: String,
    lowercase: true,
    trim: true
  }],
  
  // Keywords for search
  keywords: [{
    type: String,
    lowercase: true,
    trim: true
  }],
  
  // Content metadata
  pageCount: {
    type: Number // For documents
  },
  duration: {
    type: Number // For audio/video in seconds
  },
  
  // Access Control
  visibility: {
    type: String,
    enum: ['public', 'managers_only', 'owner_only', 'role_specific'],
    default: 'public'
  },
  allowedRoles: [{
    type: String,
    enum: ['operations', 'marketing', 'sales', 'delivery', 'finance', 'fundraising', 'legal', 'automation', 'hr', 'leadership']
  }],
  
  // Usage Statistics
  viewCount: {
    type: Number,
    default: 0
  },
  downloadCount: {
    type: Number,
    default: 0
  },
  lastAccessed: {
    type: Date
  },
  
  // Version Control
  version: {
    type: String,
    default: '1.0'
  },
  previousVersions: [{
    version: String,
    filePath: String,
    uploadedAt: Date,
    uploadedBy: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    }
  }],
  
  // Status
  status: {
    type: String,
    enum: ['active', 'archived', 'pending_review', 'under_revision'],
    default: 'active'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  
  // Featured/Priority
  isFeatured: {
    type: Boolean,
    default: false
  },
  priority: {
    type: Number,
    default: 0 // Higher number = higher priority
  },
  
  // Training Assignment
  isAssignedTraining: {
    type: Boolean,
    default: false
  },
  assignedTo: [{
    user: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    assignedAt: {
      type: Date,
      default: Date.now
    },
    dueDate: Date,
    completedAt: Date,
    status: {
      type: String,
      enum: ['pending', 'in_progress', 'completed', 'overdue'],
      default: 'pending'
    }
  }],
  
  // User Interactions
  notes: [{
    user: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    content: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  highlights: [{
    user: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    text: String,
    page: Number,
    position: {
      start: Number,
      end: Number
    },
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Ratings and Reviews
  averageRating: {
    type: Number,
    default: 0,
    min: 0,
    max: 5
  },
  ratingCount: {
    type: Number,
    default: 0
  },
  reviews: [{
    user: {
      type: mongoose.Schema.ObjectId,
      ref: 'User'
    },
    rating: {
      type: Number,
      min: 1,
      max: 5
    },
    comment: String,
    createdAt: {
      type: Date,
      default: Date.now
    }
  }],
  
  // Audit Trail
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

// Create slug from title before saving
MaterialSchema.pre('save', function(next) {
  if (this.isModified('title')) {
    this.slug = this.title.toLowerCase().replace(/[^a-zA-Z0-9]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '');
  }
  next();
});

// Index for search functionality
MaterialSchema.index({
  title: 'text',
  description: 'text',
  tags: 'text',
  keywords: 'text'
});

// Index for filtering
MaterialSchema.index({ category: 1, materialType: 1, relatedPortfolio: 1, relatedManagerRole: 1 });
MaterialSchema.index({ status: 1, isActive: 1 });
MaterialSchema.index({ createdAt: -1 });
MaterialSchema.index({ viewCount: -1, downloadCount: -1 });

// Virtual for file format category
MaterialSchema.virtual('fileCategory').get(function() {
  const documentTypes = ['pdf', 'doc', 'docx', 'txt'];
  const spreadsheetTypes = ['xls', 'xlsx'];
  const presentationTypes = ['ppt', 'pptx'];
  const audioTypes = ['mp3', 'wav'];
  const videoTypes = ['mp4', 'avi', 'mov'];
  const imageTypes = ['jpg', 'jpeg', 'png', 'gif'];
  const archiveTypes = ['zip', 'rar'];
  
  if (documentTypes.includes(this.fileType)) return 'document';
  if (spreadsheetTypes.includes(this.fileType)) return 'spreadsheet';
  if (presentationTypes.includes(this.fileType)) return 'presentation';
  if (audioTypes.includes(this.fileType)) return 'audio';
  if (videoTypes.includes(this.fileType)) return 'video';
  if (imageTypes.includes(this.fileType)) return 'image';
  if (archiveTypes.includes(this.fileType)) return 'archive';
  return 'other';
});

// Static method for search with filters
MaterialSchema.statics.searchMaterials = async function(query = {}) {
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
  } = query;
  
  const filter = { isActive: true, status: 'active' };
  
  // Add filters
  if (category) filter.category = category;
  if (materialType) filter.materialType = materialType;
  if (relatedPortfolio) filter.relatedPortfolio = relatedPortfolio;
  if (relatedManagerRole) filter.relatedManagerRole = relatedManagerRole;
  if (fileType) filter.fileType = fileType;
  if (expectedROI) filter.expectedROI = expectedROI;
  if (timeRequirement) filter.timeRequirement = timeRequirement;
  if (tags && tags.length > 0) filter.tags = { $in: tags };
  
  let aggregationPipeline = [];
  
  // Text search
  if (search) {
    aggregationPipeline.push({
      $match: {
        $text: { $search: search },
        ...filter
      }
    });
    aggregationPipeline.push({
      $addFields: { score: { $meta: "textScore" } }
    });
  } else {
    aggregationPipeline.push({ $match: filter });
  }
  
  // Populate category
  aggregationPipeline.push({
    $lookup: {
      from: 'categories',
      localField: 'category',
      foreignField: '_id',
      as: 'categoryInfo'
    }
  });
  
  // Sort
  const sortOptions = {};
  if (search) {
    sortOptions.score = { $meta: "textScore" };
  }
  sortOptions[sortBy] = sortOrder === 'desc' ? -1 : 1;
  aggregationPipeline.push({ $sort: sortOptions });
  
  // Pagination
  const skip = (page - 1) * limit;
  aggregationPipeline.push({ $skip: skip });
  aggregationPipeline.push({ $limit: parseInt(limit) });
  
  const materials = await this.aggregate(aggregationPipeline);
  const total = await this.countDocuments(search ? { $text: { $search: search }, ...filter } : filter);
  
  return {
    materials,
    pagination: {
      currentPage: parseInt(page),
      totalPages: Math.ceil(total / limit),
      totalItems: total,
      itemsPerPage: parseInt(limit)
    }
  };
};

// Method to get related materials
MaterialSchema.methods.getRelatedMaterials = async function(limit = 5) {
  const relatedMaterials = await this.constructor.find({
    _id: { $ne: this._id },
    isActive: true,
    status: 'active',
    $or: [
      { category: this.category },
      { relatedManagerRole: this.relatedManagerRole },
      { tags: { $in: this.tags } },
      { materialType: this.materialType }
    ]
  })
  .populate('category', 'name slug')
  .sort({ viewCount: -1, createdAt: -1 })
  .limit(limit);
  
  return relatedMaterials;
};

// Method to track access
MaterialSchema.methods.trackAccess = async function(type = 'view') {
  if (type === 'view') {
    this.viewCount += 1;
  } else if (type === 'download') {
    this.downloadCount += 1;
  }
  
  this.lastAccessed = new Date();
  await this.save();
};

// Method to add user note
MaterialSchema.methods.addNote = async function(userId, content) {
  this.notes.push({
    user: userId,
    content: content
  });
  await this.save();
};

// Method to add highlight
MaterialSchema.methods.addHighlight = async function(userId, text, page, position) {
  this.highlights.push({
    user: userId,
    text: text,
    page: page,
    position: position
  });
  await this.save();
};

// Method to add review
MaterialSchema.methods.addReview = async function(userId, rating, comment) {
  // Remove existing review by this user
  this.reviews = this.reviews.filter(review => String(review.user) !== String(userId));
  
  // Add new review
  this.reviews.push({
    user: userId,
    rating: rating,
    comment: comment
  });
  
  // Recalculate average rating
  const totalRating = this.reviews.reduce((sum, review) => sum + review.rating, 0);
  this.averageRating = totalRating / this.reviews.length;
  this.ratingCount = this.reviews.length;
  
  await this.save();
};

module.exports = mongoose.model('Material', MaterialSchema);