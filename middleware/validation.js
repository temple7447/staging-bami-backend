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
const validateObjectId = (paramName = 'id') => [
  param(paramName).isMongoId().withMessage('Invalid ID format')
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
  check('unitId').trim().notEmpty().withMessage('Unit ID is required').isMongoId().withMessage('Invalid unit ID'),

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

  // Email: strip invalid emails instead of blocking the request
  // (e.g. if user types a name instead of an email, just save with no email)
  check('tenantEmail').optional({ checkFalsy: true })
    .customSanitizer(v => (v && v.includes('@') ? v : undefined))
    .if(body('tenantEmail').notEmpty())
    .isEmail().withMessage('Invalid email').normalizeEmail(),
  check('email').optional({ checkFalsy: true })
    .customSanitizer(v => (v && v.includes('@') ? v : undefined))
    .if(body('email').notEmpty())
    .isEmail().withMessage('Invalid email').normalizeEmail(),

  // Phone/WhatsApp — strip spaces so '0705 078 2155' works fine
  check('tenantPhone').optional({ checkFalsy: true })
    .customSanitizer(v => (v ? String(v).replace(/\s+/g, '') : v))
    .isLength({ min: 5, max: 25 }).withMessage('Invalid phone'),
  check('whatsapp').optional({ checkFalsy: true })
    .customSanitizer(v => (v ? String(v).replace(/\s+/g, '') : v))
    .isLength({ min: 5, max: 25 }).withMessage('Invalid WhatsApp number'),

  check('rentAmount').optional().isInt({ min: 0 }).toInt(),
  check('tenantType')
    .optional()
    .customSanitizer(v => (v === 'old' ? 'existing' : v))
    .isIn(['new', 'existing', 'renewal', 'transfer'])
    .withMessage('Invalid tenant type'),

  // Dates: accept ISO or dd/mm/yyyy; we'll parse format in controller if not ISO
  check('entryDate').optional().isString().withMessage('entryDate must be a string date'),
  check('nextDueDate').optional().isString().withMessage('nextDueDate must be a string date'),

  // Billing period length in months (if provided, nextDueDate will be auto-calculated)
  check('durationMonths')
    .optional()
    .isInt({ min: 1, max: 12 }).withMessage('durationMonths must be between 1 and 12')
    .toInt(),

  // Outstanding balances for existing tenants
  check('rentOutstanding').optional().isFloat({ min: 0 }).withMessage('rentOutstanding must be a non-negative number').toFloat(),
  check('serviceChargeOutstanding').optional().isFloat({ min: 0 }).withMessage('serviceChargeOutstanding must be a non-negative number').toFloat(),
];

const validateTenantUpdate = [
  check('unitId').optional().trim().isMongoId().withMessage('Invalid unit ID'),

  // Allow updating name via either full name or parts
  check('tenantName').optional().trim().notEmpty().withMessage('Tenant name cannot be empty').isLength({ max: 150 }).withMessage('Tenant name cannot be more than 150 characters'),
  check('firstName').optional().trim().isLength({ min: 1, max: 100 }).withMessage('First name must be between 1 and 100 characters'),
  check('surname').optional().trim().isLength({ min: 1, max: 100 }).withMessage('Surname must be between 1 and 100 characters'),
  check('otherNames').optional().trim().isLength({ max: 100 }).withMessage('Other names cannot be more than 100 characters'),

  check('tenantEmail').optional({ checkFalsy: true })
    .customSanitizer(v => (v && v.includes('@') ? v : undefined))
    .if(body('tenantEmail').notEmpty())
    .isEmail().withMessage('Invalid email').normalizeEmail(),
  check('email').optional({ checkFalsy: true })
    .customSanitizer(v => (v && v.includes('@') ? v : undefined))
    .if(body('email').notEmpty())
    .isEmail().withMessage('Invalid email').normalizeEmail(),
  check('tenantPhone').optional({ checkFalsy: true })
    .customSanitizer(v => (v ? String(v).replace(/\s+/g, '') : v))
    .isLength({ min: 5, max: 25 }).withMessage('Invalid phone number'),
  check('whatsapp').optional({ checkFalsy: true })
    .customSanitizer(v => (v ? String(v).replace(/\s+/g, '') : v))
    .isLength({ min: 5, max: 25 }).withMessage('Invalid WhatsApp number'),
  check('rentAmount').optional().isInt({ min: 0 }).withMessage('Rent amount must be a non-negative number').toInt(),
  check('serviceChargeAmount').optional().isInt({ min: 0 }).withMessage('Service charge must be a non-negative number').toInt(),
  check('tenantType')
    .optional()
    .customSanitizer(v => (v === 'old' ? 'existing' : v))
    .isIn(['new', 'existing', 'renewal', 'transfer'])
    .withMessage('Tenant type must be one of: new, existing, renewal, transfer'),
  check('status')
    .optional()
    .isIn(['occupied', 'vacant', 'pending', 'evicted'])
    .withMessage('Status must be one of: occupied, vacant, pending, evicted'),
  check('electricMeterNumber').optional().isString().withMessage('Invalid meter number'),
  check('entryDate').optional().isString().withMessage('entryDate must be a string date'),
  check('nextDueDate').optional().isString().withMessage('nextDueDate must be a string date')
];

// Transaction validators
const validateTransactionCreate = [
  check('amount').notEmpty().withMessage('Amount is required').isInt({ min: 0 }).withMessage('Amount must be a non-negative integer').toInt(),
  check('type').notEmpty().isIn(['rent', 'utility', 'deposit', 'service_charge', 'other']).withMessage('Invalid type'),
  check('method').optional().isIn(['cash', 'transfer', 'card', 'bank', 'other']).withMessage('Invalid method'),
  check('status').optional().isIn(['paid', 'pending', 'failed']).withMessage('Invalid status'),
  check('periodMonth').optional().isInt({ min: 1, max: 12 }).toInt(),
  check('periodYear').optional().isInt({ min: 1900 }).toInt(),
  check('reference').optional().isLength({ max: 120 }),
  check('notes').optional().isLength({ max: 1000 }),
  check('durationMonths').optional().isInt({ min: 1, max: 12 }).withMessage('durationMonths must be between 1 and 12').toInt()
];

const validateHistoryCreate = [
  check('event').notEmpty().isIn(['created', 'moved_in', 'moved_out', 'rent_update', 'payment', 'note']).withMessage('Invalid event'),
  check('note').optional().isLength({ max: 1000 }),
  check('meta').optional().isObject()
];


// Unified wallet transaction validators
const validateWalletTransaction = [
  body('type')
    .notEmpty().withMessage('Transaction type is required')
    .isIn(['deposit', 'withdraw', 'transfer']).withMessage('Type must be deposit, withdraw, or transfer'),
  body('amount')
    .notEmpty().withMessage('Amount is required')
    .isFloat({ min: 1 }).withMessage('Amount must be greater than 0'),
  body('description')
    .optional()
    .isLength({ max: 500 }).withMessage('Description cannot exceed 500 characters'),
  body('recipientEmail')
    .optional()
    .isEmail().withMessage('Invalid recipient email'),
  body('recipientId')
    .optional()
    .isMongoId().withMessage('Invalid recipient ID'),
  body('recipientType')
    .optional()
    .isIn(['user', 'estate']).withMessage('Recipient type must be user or estate'),
  body().custom((value, { req }) => {
    const { type, bankDetails, recipientEmail, recipientId, recipientType } = req.body;

    if (type === 'withdraw') {
      if (!bankDetails) {
        throw new Error('Bank details are required for withdrawals');
      }
      if (!bankDetails.accountName) {
        throw new Error('Account name is required');
      }
      if (!bankDetails.accountNumber) {
        throw new Error('Account number is required');
      }
      if (!bankDetails.bankName) {
        throw new Error('Bank name is required');
      }
    }

    if (type === 'transfer') {
      if (!recipientEmail && !recipientId) {
        throw new Error('Recipient email or ID is required for transfers');
      }
      if (!recipientType) {
        throw new Error('Recipient type is required for transfers');
      }
    }

    return true;
  })
];

module.exports = {
  handleValidationErrors,
  validateObjectId,
  validateEstateCreate,
  validateEstateUpdate,
  validateTenantCreate,
  validateTenantUpdate,
  validateTransactionCreate,
  validateHistoryCreate,
  validateWalletTransaction
};
