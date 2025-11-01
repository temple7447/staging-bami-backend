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

// MongoDB ObjectId validation
const validateObjectId = [
  param('id').isMongoId().withMessage('Invalid ID format')
];

// Estate validators
const validateEstateCreate = [
  check('name')
    .trim()
    .notEmpty().withMessage('Estate name is required')
    .isLength({ max: 150 }).withMessage('Estate name cannot be more than 150 characters'),
  body('description')
    .optional()
    .isLength({ max: 1000 }).withMessage('Description cannot be more than 1000 characters')
];

const validateEstateUpdate = [
  check('name')
    .optional()
    .trim()
    .notEmpty().withMessage('Estate name cannot be empty')
    .isLength({ max: 150 }).withMessage('Estate name cannot be more than 150 characters'),
  body('description')
    .optional()
    .isLength({ max: 1000 }).withMessage('Description cannot be more than 1000 characters')
];

module.exports = {
  handleValidationErrors,
  validateObjectId,
  validateEstateCreate,
  validateEstateUpdate
};
