const { body, check, param, validationResult } = require('express-validator');

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

// Allowed material types (add 'video' here)
const materialTypeAllowed = [
  'guide',
  'case_study',
  'how_to',
  'template',
  'checklist',
  'presentation',
  'video_tutorial',
  'video',         // <-- added
  'audio_note',
  'document',
  'image',
  'other'
];

// Validator for creating a material
const validateMaterialUpload = [
  check('title')
    .notEmpty().withMessage('Title is required')
    .isLength({ max: 200 }).withMessage('Title cannot be more than 200 characters'),
  check('category')
    .notEmpty().withMessage('Category is required')
    .isMongoId().withMessage('Invalid category id'),
  check('materialType')
    .notEmpty().withMessage('Material type is required')
    .isIn(materialTypeAllowed).withMessage(`Material type must be one of: ${materialTypeAllowed.join(', ')}`),
  body('videoUrl')
    .optional()
    .isURL().withMessage('videoUrl must be a valid URL'),
  // custom rule: when materialType === 'video' require either an uploaded file (req.file) or a videoUrl
  check('materialType').custom((value, { req }) => {
    if (value === 'video') {
      if (!req.file && !req.body.videoUrl) {
        throw new Error('Video materials require either an uploaded file (form field "file") or a "videoUrl"');
      }
    }
    return true;
  }),
  // ...any other existing validators like expectedROI, timeRequirement etc...
];

// Validator for updating a material (make materialType optional but still validate values)
const validateMaterialUpdate = [
  check('title')
    .optional()
    .isLength({ max: 200 }).withMessage('Title cannot be more than 200 characters'),
  check('category')
    .optional()
    .isMongoId().withMessage('Invalid category id'),
  check('materialType')
    .optional()
    .isIn(materialTypeAllowed).withMessage(`Material type must be one of: ${materialTypeAllowed.join(', ')}`),
  body('videoUrl')
    .optional()
    .isURL().withMessage('videoUrl must be a valid URL'),
  // if materialType provided as 'video' on update, ensure file or videoUrl exists
  check('materialType').optional().custom((value, { req }) => {
    if (value === 'video') {
      // req.file may be undefined during update routes (if uploadSingle isn't used) so require at least videoUrl
      if (!req.file && !req.body.videoUrl) {
        throw new Error('When changing materialType to "video", provide a "videoUrl" or upload a file');
      }
    }
    return true;
  }),
  // ...any other existing validators...
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