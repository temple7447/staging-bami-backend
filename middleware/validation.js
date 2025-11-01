const { param, validationResult } = require('express-validator');

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

module.exports = {
  handleValidationErrors,
  validateObjectId
};
