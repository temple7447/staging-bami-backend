const { body, param, validationResult } = require('express-validator');

// Handle validation errors
const handleValidationErrors = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    return res.status(400).json({
      success: false,
      message: 'Validation errors',
      errors: errors.array()
    });
  }
  next();
};

// Category validation rules
const validateCategoryCreation = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Category name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z0-9\s&-]+$/)
    .withMessage('Category name can only contain letters, numbers, spaces, hyphens, and ampersands'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot be more than 500 characters'),
  
  body('parentCategory')
    .optional()
    .isMongoId()
    .withMessage('Parent category must be a valid MongoDB ID'),
  
  body('icon')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Icon name must be between 1 and 50 characters'),
  
  body('color')
    .optional()
    .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
    .withMessage('Color must be a valid hex color code'),
  
  body('order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Order must be a positive integer')
];

const validateCategoryUpdate = [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage('Category name must be between 2 and 100 characters')
    .matches(/^[a-zA-Z0-9\s&-]+$/)
    .withMessage('Category name can only contain letters, numbers, spaces, hyphens, and ampersands'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Description cannot be more than 500 characters'),
  
  body('parentCategory')
    .optional()
    .custom((value) => {
      if (value === null || value === '') return true;
      return /^[0-9a-fA-F]{24}$/.test(value);
    })
    .withMessage('Parent category must be a valid MongoDB ID or null'),
  
  body('icon')
    .optional()
    .trim()
    .isLength({ min: 1, max: 50 })
    .withMessage('Icon name must be between 1 and 50 characters'),
  
  body('color')
    .optional()
    .matches(/^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/)
    .withMessage('Color must be a valid hex color code'),
  
  body('order')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Order must be a positive integer')
];

// Material validation rules
const validateMaterialUpload = [
  body('title')
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Material title must be between 2 and 200 characters'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Description cannot be more than 1000 characters'),
  
  body('category')
    .isMongoId()
    .withMessage('Category must be a valid MongoDB ID'),
  
  body('relatedPortfolio')
    .isIn(['personal', 'business', 'estate', 'equipment', 'investments', 'other'])
    .withMessage('Related portfolio must be one of: personal, business, estate, equipment, investments, other'),
  
  body('relatedManagerRole')
    .isIn(['operations', 'marketing', 'sales', 'delivery', 'finance', 'fundraising', 'legal', 'automation', 'hr', 'leadership'])
    .withMessage('Related manager role must be one of: operations, marketing, sales, delivery, finance, fundraising, legal, automation, hr, leadership'),
  
  body('materialType')
    .isIn(['guide', 'case_study', 'how_to', 'template', 'checklist', 'presentation', 'video_tutorial', 'audio_note', 'document', 'image', 'other'])
    .withMessage('Material type must be one of: guide, case_study, how_to, template, checklist, presentation, video_tutorial, audio_note, document, image, other'),
  
  body('expectedROI')
    .optional()
    .isIn(['high', 'medium', 'low'])
    .withMessage('Expected ROI must be one of: high, medium, low'),
  
  body('timeRequirement')
    .optional()
    .isIn(['quick', 'medium', 'deep_study'])
    .withMessage('Time requirement must be one of: quick, medium, deep_study'),
  
  body('tags')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        const tags = value.split(',').map(tag => tag.trim());
        return tags.every(tag => tag.length >= 1 && tag.length <= 50);
      }
      if (Array.isArray(value)) {
        return value.every(tag => typeof tag === 'string' && tag.length >= 1 && tag.length <= 50);
      }
      return true;
    })
    .withMessage('Each tag must be between 1 and 50 characters'),
  
  body('keywords')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        const keywords = value.split(',').map(keyword => keyword.trim());
        return keywords.every(keyword => keyword.length >= 1 && keyword.length <= 50);
      }
      if (Array.isArray(value)) {
        return value.every(keyword => typeof keyword === 'string' && keyword.length >= 1 && keyword.length <= 50);
      }
      return true;
    })
    .withMessage('Each keyword must be between 1 and 50 characters'),
  
  body('pageCount')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page count must be a positive integer'),
  
  body('duration')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Duration must be a positive integer (in seconds)'),
  
  body('visibility')
    .optional()
    .isIn(['public', 'managers_only', 'owner_only', 'role_specific'])
    .withMessage('Visibility must be one of: public, managers_only, owner_only, role_specific'),
  
  body('allowedRoles')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        const roles = value.split(',').map(role => role.trim());
        const validRoles = ['operations', 'marketing', 'sales', 'delivery', 'finance', 'fundraising', 'legal', 'automation', 'hr', 'leadership'];
        return roles.every(role => validRoles.includes(role));
      }
      if (Array.isArray(value)) {
        const validRoles = ['operations', 'marketing', 'sales', 'delivery', 'finance', 'fundraising', 'legal', 'automation', 'hr', 'leadership'];
        return value.every(role => typeof role === 'string' && validRoles.includes(role));
      }
      return true;
    })
    .withMessage('Each allowed role must be one of: operations, marketing, sales, delivery, finance, fundraising, legal, automation, hr, leadership'),
  
  body('priority')
    .optional()
    .isInt({ min: 0, max: 10 })
    .withMessage('Priority must be an integer between 0 and 10')
];

const validateMaterialUpdate = [
  body('title')
    .optional()
    .trim()
    .isLength({ min: 2, max: 200 })
    .withMessage('Material title must be between 2 and 200 characters'),
  
  body('description')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Description cannot be more than 1000 characters'),
  
  body('category')
    .optional()
    .isMongoId()
    .withMessage('Category must be a valid MongoDB ID'),
  
  body('relatedPortfolio')
    .optional()
    .isIn(['personal', 'business', 'estate', 'equipment', 'investments', 'other'])
    .withMessage('Related portfolio must be one of: personal, business, estate, equipment, investments, other'),
  
  body('relatedManagerRole')
    .optional()
    .isIn(['operations', 'marketing', 'sales', 'delivery', 'finance', 'fundraising', 'legal', 'automation', 'hr', 'leadership'])
    .withMessage('Related manager role must be one of: operations, marketing, sales, delivery, finance, fundraising, legal, automation, hr, leadership'),
  
  body('materialType')
    .optional()
    .isIn(['guide', 'case_study', 'how_to', 'template', 'checklist', 'presentation', 'video_tutorial', 'audio_note', 'document', 'image', 'other'])
    .withMessage('Material type must be one of: guide, case_study, how_to, template, checklist, presentation, video_tutorial, audio_note, document, image, other'),
  
  body('expectedROI')
    .optional()
    .isIn(['high', 'medium', 'low'])
    .withMessage('Expected ROI must be one of: high, medium, low'),
  
  body('timeRequirement')
    .optional()
    .isIn(['quick', 'medium', 'deep_study'])
    .withMessage('Time requirement must be one of: quick, medium, deep_study'),
  
  body('tags')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        const tags = value.split(',').map(tag => tag.trim());
        return tags.every(tag => tag.length >= 1 && tag.length <= 50);
      }
      if (Array.isArray(value)) {
        return value.every(tag => typeof tag === 'string' && tag.length >= 1 && tag.length <= 50);
      }
      return true;
    })
    .withMessage('Each tag must be between 1 and 50 characters'),
  
  body('keywords')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        const keywords = value.split(',').map(keyword => keyword.trim());
        return keywords.every(keyword => keyword.length >= 1 && keyword.length <= 50);
      }
      if (Array.isArray(value)) {
        return value.every(keyword => typeof keyword === 'string' && keyword.length >= 1 && keyword.length <= 50);
      }
      return true;
    })
    .withMessage('Each keyword must be between 1 and 50 characters'),
  
  body('pageCount')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page count must be a positive integer'),
  
  body('duration')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Duration must be a positive integer (in seconds)'),
  
  body('visibility')
    .optional()
    .isIn(['public', 'managers_only', 'owner_only', 'role_specific'])
    .withMessage('Visibility must be one of: public, managers_only, owner_only, role_specific'),
  
  body('allowedRoles')
    .optional()
    .custom((value) => {
      if (typeof value === 'string') {
        const roles = value.split(',').map(role => role.trim());
        const validRoles = ['operations', 'marketing', 'sales', 'delivery', 'finance', 'fundraising', 'legal', 'automation', 'hr', 'leadership'];
        return roles.every(role => validRoles.includes(role));
      }
      if (Array.isArray(value)) {
        const validRoles = ['operations', 'marketing', 'sales', 'delivery', 'finance', 'fundraising', 'legal', 'automation', 'hr', 'leadership'];
        return value.every(role => typeof role === 'string' && validRoles.includes(role));
      }
      return true;
    })
    .withMessage('Each allowed role must be one of: operations, marketing, sales, delivery, finance, fundraising, legal, automation, hr, leadership'),
  
  body('priority')
    .optional()
    .isInt({ min: 0, max: 10 })
    .withMessage('Priority must be an integer between 0 and 10'),
  
  body('status')
    .optional()
    .isIn(['active', 'archived', 'pending_review', 'under_revision'])
    .withMessage('Status must be one of: active, archived, pending_review, under_revision')
];

// Note validation
const validateNote = [
  body('content')
    .trim()
    .isLength({ min: 1, max: 1000 })
    .withMessage('Note content must be between 1 and 1000 characters')
];

// Highlight validation
const validateHighlight = [
  body('text')
    .trim()
    .isLength({ min: 1, max: 500 })
    .withMessage('Highlight text must be between 1 and 500 characters'),
  
  body('page')
    .optional()
    .isInt({ min: 1 })
    .withMessage('Page must be a positive integer'),
  
  body('position')
    .optional()
    .isObject()
    .withMessage('Position must be an object'),
  
  body('position.start')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Position start must be a non-negative integer'),
  
  body('position.end')
    .optional()
    .isInt({ min: 0 })
    .withMessage('Position end must be a non-negative integer')
];

// Review validation
const validateReview = [
  body('rating')
    .isInt({ min: 1, max: 5 })
    .withMessage('Rating must be an integer between 1 and 5'),
  
  body('comment')
    .optional()
    .trim()
    .isLength({ max: 500 })
    .withMessage('Comment cannot be more than 500 characters')
];

// MongoDB ObjectId validation
const validateObjectId = [
  param('id')
    .isMongoId()
    .withMessage('Invalid ID format')
];

module.exports = {
  handleValidationErrors,
  validateCategoryCreation,
  validateCategoryUpdate,
  validateMaterialUpload,
  validateMaterialUpdate,
  validateNote,
  validateHighlight,
  validateReview,
  validateObjectId
};