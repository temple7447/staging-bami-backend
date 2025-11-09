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
  check('totalUnits')
    .notEmpty().withMessage('Total units is required')
    .isInt({ min: 0 }).withMessage('Total units must be a non-negative integer')
    .toInt(),
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
  check('totalUnits')
    .optional()
    .isInt({ min: 0 }).withMessage('Total units must be a non-negative integer')
    .toInt(),
  body('description')
    .optional()
    .isLength({ max: 1000 }).withMessage('Description cannot be more than 1000 characters')
];

// Tenant validators
const validateTenantCreate = [
  check('unitLabel').trim().notEmpty().withMessage('Unit label is required').isLength({ max: 100 }),

  // Accept either tenantName OR (firstName + surname); otherNames optional
  check('tenantName').optional().trim().isLength({ max: 150 }).withMessage('Tenant name cannot be more than 150 characters'),
  check('firstName').optional().trim().isLength({ min: 1, max: 100 }).withMessage('First name must be between 1 and 100 characters'),
  check('surname').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Surname must be between 1 and 100 characters'),
  check('otherNames').optional().trim().isLength({ max: 100 }).withMessage('Other names cannot be more than 100 characters'),
  body().custom((value, { req }) => {
    if (!req.body.tenantName && !(req.body.firstName && req.body.surname)) {
      throw new Error('Provide tenantName or firstName and surname');
    }
    return true;
  }),

  // Email: accept either tenantEmail or email
  check('tenantEmail').optional().isEmail().withMessage('Invalid email').normalizeEmail(),
  check('email').optional().isEmail().withMessage('Invalid email').normalizeEmail(),

  // Phone/WhatsApp
  check('tenantPhone').optional().isLength({ min: 5, max: 25 }).withMessage('Invalid phone'),
  check('whatsapp').optional().isLength({ min: 5, max: 25 }).withMessage('Invalid WhatsApp number'),

  check('rentAmount').notEmpty().withMessage('Rent amount is required').isInt({ min: 0 }).withMessage('Rent amount must be a non-negative integer').toInt(),
  check('tenantType')
    .optional()
    .customSanitizer(v => (v === 'old' ? 'existing' : v))
    .isIn(['new','existing','renewal','transfer'])
    .withMessage('Invalid tenant type'),
  check('electricMeterNumber').optional().isLength({ max: 100 }),

  // Date: accept ISO or dd/mm/yyyy; we'll parse format in controller if not ISO
  check('nextDueDate').optional().isString().withMessage('nextDueDate must be a string date')
];

const validateTenantUpdate = [
  check('unitLabel').optional().trim().notEmpty().isLength({ max: 100 }),

  // Allow updating name via either full name or parts
  check('tenantName').optional().trim().notEmpty().isLength({ max: 150 }),
  check('firstName').optional().trim().isLength({ min: 1, max: 100 }),
  check('surname').optional().trim().isLength({ min: 1, max: 100 }),
  check('otherNames').optional().trim().isLength({ max: 100 }),

  check('tenantEmail').optional().isEmail().normalizeEmail(),
  check('email').optional().isEmail().normalizeEmail(),
  check('tenantPhone').optional().isLength({ min: 5, max: 25 }),
  check('whatsapp').optional().isLength({ min: 5, max: 25 }),
  check('rentAmount').optional().isInt({ min: 0 }).toInt(),
  check('tenantType')
    .optional()
    .customSanitizer(v => (v === 'old' ? 'existing' : v))
    .isIn(['new','existing','renewal','transfer']),
  check('electricMeterNumber').optional().isLength({ max: 100 }),
  check('nextDueDate').optional().isString()
];

// Transaction validators
const validateTransactionCreate = [
  check('amount').notEmpty().withMessage('Amount is required').isInt({ min: 0 }).withMessage('Amount must be a non-negative integer').toInt(),
  check('type').notEmpty().isIn(['rent','utility','deposit','other']).withMessage('Invalid type'),
  check('method').optional().isIn(['cash','transfer','card','bank','other']).withMessage('Invalid method'),
  check('status').optional().isIn(['paid','pending','failed']).withMessage('Invalid status'),
  check('periodMonth').optional().isInt({ min:1, max:12 }).toInt(),
  check('periodYear').optional().isInt({ min:1900 }).toInt(),
  check('reference').optional().isLength({ max: 120 }),
  check('notes').optional().isLength({ max: 1000 })
];

const validateHistoryCreate = [
  check('event').notEmpty().isIn(['created','moved_in','moved_out','rent_update','payment','note']).withMessage('Invalid event'),
  check('note').optional().isLength({ max: 1000 }),
  check('meta').optional().isObject()
];

module.exports = {
  handleValidationErrors,
  validateObjectId,
  validateEstateCreate,
  validateEstateUpdate,
  validateTenantCreate,
  validateTenantUpdate,
  validateTransactionCreate,
  validateHistoryCreate
};
