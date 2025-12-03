const express = require('express');
const router = express.Router({ mergeParams: true });

const { protect } = require('../middleware/auth');
const multer = require('multer');
const imageStorage = multer.memoryStorage();
const imageOnly = (req, file, cb) => {
  const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Only image files are allowed'));
};
const imageUpload = multer({ storage: imageStorage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: imageOnly });

const {
  validateObjectId,
  handleValidationErrors,
  validateTenantCreate,
  validateTenantUpdate,
  validateShiftDueDate,
} = require('../middleware/validation');

const {
  createTenant,
  getTenants,
  getTenant,
  updateTenant,
  deleteTenant,
  uploadTenantAvatar,
  uploadMyAvatar,
  getMyTenant,
  listMyHistory,
  getQuarterlyRentByDueMonth,
  shiftNextDueDate,
} = require('../controllers/tenantController');

// Nested: /api/estates/:estateId/tenants (list/create for a given estate)
router.get('/', protect, getTenants);
router.post('/', protect, validateTenantCreate, handleValidationErrors, createTenant);

// Summary/reporting routes (must be before /:id routes)
router.get('/summary/quarters', protect, getQuarterlyRentByDueMonth);

// Special routes (must be before /:id routes)
router.get('/me', protect, getMyTenant);
router.get('/me/history', protect, listMyHistory);
router.post('/me/avatar', protect, imageUpload.single('file'), uploadMyAvatar);

// Single tenant ops - parameterized routes
router.get('/:id', protect, validateObjectId('id'), handleValidationErrors, getTenant);
router.put('/:id', protect, validateObjectId('id'), validateTenantUpdate, handleValidationErrors, updateTenant);
router.delete('/:id', protect, validateObjectId('id'), handleValidationErrors, deleteTenant);

// Shift next due date endpoint - MUST be before catch-all /:id routes
router.post('/:id/shift-due-date', protect, validateObjectId('id'), validateShiftDueDate, handleValidationErrors, shiftNextDueDate);

// History endpoints
router.get('/:id/history', protect, validateObjectId('id'), handleValidationErrors, require('../controllers/tenantController').listHistory);
router.post('/:id/history', protect, validateObjectId('id'), require('../middleware/validation').validateHistoryCreate, handleValidationErrors, require('../controllers/tenantController').addHistory);

// Billing endpoints (what this tenant should pay for)
router.get('/:id/billing', protect, validateObjectId('id'), handleValidationErrors, require('../controllers/tenantController').listBillingItems);

// Transaction endpoints
router.get('/:id/transactions', protect, validateObjectId('id'), handleValidationErrors, require('../controllers/tenantController').listTransactions);
router.post('/:id/transactions', protect, validateObjectId('id'), require('../middleware/validation').validateTransactionCreate, handleValidationErrors, require('../controllers/tenantController').addTransaction);

// Avatar upload
router.post('/:id/avatar', protect, validateObjectId('id'), handleValidationErrors, imageUpload.single('file'), uploadTenantAvatar);

// Multer error handler (JSON)
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes('Only')) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
});

module.exports = router;
