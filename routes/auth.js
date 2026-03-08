const express = require('express');
const { body } = require('express-validator');
const {
  registerSuperAdmin,
  login,
  logout,
  getMe,
  updateDetails,
  updatePassword,
  forgotPassword,
  resetPassword,
  forgotPasswordOtp,
  resetPasswordWithOtp,
  verifyPasswordOtp,
  createAdmin,
  getAdmins,
  updateAdminStatus,
  deleteAdmin,
  updateSuperAdminEmail,
  onboardBusinessOwner,
  getBusinessOwners,
  updateBusinessOwner,
  updateBusinessOwnerStatus,
  deleteBusinessOwner,
  onboardVendor,
  getVendors,
  updateVendor,
  updateVendorStatus,
  deleteVendor,
  onboardManager,
  getManagers,
  updateManager,
  updateManagerStatus,
  deleteManager,
  getPublicVendors,
  getPublicVendorDetail,
  uploadAvatar
} = require('../controllers/authController');

const { protect, superAdminOnly, adminOrSuperAdmin } = require('../middleware/auth');

const router = express.Router();

// Validation middleware
const validateRegister = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('Password must contain at least one uppercase letter, one lowercase letter, and one number')
];

const validateLogin = [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
];

const validateUpdatePassword = [
  body('currentPassword')
    .notEmpty()
    .withMessage('Current password is required'),
  body('newPassword')
    .isLength({ min: 6 })
    .withMessage('New password must be at least 6 characters long')
    .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .withMessage('New password must contain at least one uppercase letter, one lowercase letter, and one number')
];

const validateCreateAdmin = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .optional()
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
];

// Validation error handler
const handleValidationErrors = (req, res, next) => {
  const { validationResult } = require('express-validator');
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

// Public routes
router.post('/register-super-admin', validateRegister, handleValidationErrors, registerSuperAdmin);
router.post('/login', validateLogin, handleValidationErrors, login);
router.post('/forgotpassword', forgotPassword);
router.put('/resetpassword/:resettoken', resetPassword);

// OTP-based password reset
router.post('/forgotpassword-otp', [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email')
], handleValidationErrors, forgotPasswordOtp);
router.post('/resetpassword-otp', [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('code')
    .notEmpty()
    .withMessage('OTP code is required')
    .isLength({ min: 6, max: 6 })
    .withMessage('OTP must be 6 digits'),
  body('password')
    .isLength({ min: 6 })
    .withMessage('Password must be at least 6 characters long')
], handleValidationErrors, resetPasswordWithOtp);
router.post('/verify-otp', [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('code')
    .notEmpty()
    .withMessage('OTP code is required')
], handleValidationErrors, verifyPasswordOtp);

const multer = require('multer');
const imageStorage = multer.memoryStorage();
const imageOnly = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Only image files are allowed'));
};
const imageUpload = multer({ storage: imageStorage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: imageOnly });

// Protected routes (require authentication)
router.get('/logout', logout);
router.get('/me', protect, getMe);
router.put('/me/avatar', protect, imageUpload.single('file'), uploadAvatar);
router.post('/me/avatar', protect, imageUpload.single('file'), uploadAvatar);
router.put('/updatedetails', protect, updateDetails);
router.put('/updatepassword', protect, validateUpdatePassword, handleValidationErrors, updatePassword);

// Super Admin only routes
router.post('/create-admin', protect, superAdminOnly, validateCreateAdmin, handleValidationErrors, createAdmin);
router.get('/admins', protect, superAdminOnly, getAdmins);
router.put('/admin/:id/status', protect, superAdminOnly, updateAdminStatus);
router.delete('/admin/:id', protect, superAdminOnly, deleteAdmin);
router.put('/update-superadmin-email', protect, superAdminOnly, [
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('password')
    .notEmpty()
    .withMessage('Password is required')
], handleValidationErrors, updateSuperAdminEmail);

// Validation for business owner onboarding
const validateOnboardBusinessOwner = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  body('estateIds')
    .optional()
    .isArray()
    .withMessage('Estate IDs must be an array')
];

router.post('/onboard-business-owner', protect, superAdminOnly, validateOnboardBusinessOwner, handleValidationErrors, onboardBusinessOwner);

// Business owner management routes (Super Admin only)
router.get('/business-owners', protect, superAdminOnly, getBusinessOwners);
router.put('/business-owner/:id', protect, superAdminOnly, [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  body('estateIds')
    .optional()
    .isArray()
    .withMessage('Estate IDs must be an array')
], handleValidationErrors, updateBusinessOwner);
router.put('/business-owner/:id/status', protect, superAdminOnly, updateBusinessOwnerStatus);
router.delete('/business-owner/:id', protect, superAdminOnly, deleteBusinessOwner);

// Vendor management routes (Admin and Super Admin)
const validateOnboardVendor = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  body('position')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Position cannot be more than 100 characters'),
  body('managerId')
    .notEmpty()
    .withMessage('Manager is required'),
  body('businessTypeId')
    .optional()
    .isMongoId()
    .withMessage('Please provide a valid business type ID')
];

router.post('/onboard-vendor', protect, validateOnboardVendor, handleValidationErrors, onboardVendor);
router.get('/vendors', protect, getVendors);
router.put('/vendor/:id', protect, [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  body('businessTypeId')
    .optional()
    .isMongoId()
    .withMessage('Please provide a valid business type ID'),
  body('businessName')
    .optional()
    .trim()
    .isString()
    .withMessage('Business name must be a string'),
  body('specialization')
    .optional()
    .trim()
    .isString()
    .withMessage('Specialization must be a string'),
  body('cacNumber')
    .optional()
    .trim()
    .isString()
    .withMessage('CAC Number must be a string'),
  body('govId')
    .optional()
    .trim()
    .isString()
    .withMessage('Government ID must be a valid URL string'),
  body('certification')
    .optional()
    .trim()
    .isString()
    .withMessage('Certification must be a valid URL string'),
  body('businessAddress')
    .optional()
    .trim()
    .isString()
    .withMessage('Business address must be a string'),
  body('portfolio')
    .optional()
    .isArray({ max: 5 })
    .withMessage('Portfolio must be an array with a maximum of 5 images'),
  body('bio')
    .optional()
    .trim()
    .isLength({ max: 1000 })
    .withMessage('Bio cannot exceed 1000 characters'),
  body('location')
    .optional()
    .isObject()
    .withMessage('Location must be an object'),
  body('operationalHours')
    .optional()
    .isObject()
    .withMessage('Operational hours must be an object'),
  body('isVerifiedPro')
    .optional()
    .isBoolean()
    .withMessage('isVerifiedPro must be a boolean'),
  body('services')
    .optional()
    .isArray()
    .withMessage('Services must be an array'),
  body('services.*.name')
    .if(body('services').exists())
    .notEmpty()
    .withMessage('Service name is required'),
  body('services.*.price')
    .if(body('services').exists())
    .isNumeric()
    .withMessage('Service price must be a number')
], handleValidationErrors, updateVendor);
router.put('/vendor/:id/status', protect, updateVendorStatus);
router.delete('/vendor/:id', protect, deleteVendor);

// Manager management routes (Admin and Super Admin)
const validateOnboardManager = [
  body('name')
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('email')
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  body('position')
    .optional()
    .trim()
    .isLength({ max: 100 })
    .withMessage('Position cannot be more than 100 characters')
];

router.post('/onboard-manager', protect, adminOrSuperAdmin, validateOnboardManager, handleValidationErrors, onboardManager);
router.get('/managers', protect, adminOrSuperAdmin, getManagers);
router.put('/manager/:id', protect, adminOrSuperAdmin, [
  body('name')
    .optional()
    .trim()
    .isLength({ min: 2, max: 50 })
    .withMessage('Name must be between 2 and 50 characters'),
  body('email')
    .optional()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email'),
  body('phone')
    .optional()
    .isMobilePhone()
    .withMessage('Please provide a valid phone number'),
  body('estateIds')
    .optional()
    .isArray()
    .withMessage('Estate IDs must be an array')
], handleValidationErrors, updateManager);
router.put('/manager/:id/status', protect, adminOrSuperAdmin, updateManagerStatus);
router.delete('/manager/:id', protect, adminOrSuperAdmin, deleteManager);

// Public Vendor Routes
router.get('/public/vendors', getPublicVendors);
router.get('/public/vendors/:id', getPublicVendorDetail);

module.exports = router;