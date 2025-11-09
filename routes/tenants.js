const express = require('express');
const router = express.Router({ mergeParams: true });

const { protect } = require('../middleware/auth');
const multer = require('multer');
const imageStorage = multer.memoryStorage();
const imageOnly = (req, file, cb) => {
  const allowed = ['image/jpeg','image/png','image/gif','image/webp','image/svg+xml'];
  if (allowed.includes(file.mimetype)) return cb(null, true);
  cb(new Error('Only image files are allowed'));
};
const imageUpload = multer({ storage: imageStorage, limits: { fileSize: 10 * 1024 * 1024 }, fileFilter: imageOnly });

const {
  validateObjectId,
  handleValidationErrors,
  validateTenantCreate,
  validateTenantUpdate,
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
} = require('../controllers/tenantController');

// Nested: /api/estates/:estateId/tenants (list/create for a given estate)
router.get('/', protect, getTenants);
router.post('/', protect, validateTenantCreate, handleValidationErrors, createTenant);

// Non-nested: /api/tenants (list all)
// When mounted at /api/tenants, estateId is undefined so returns all

// Single tenant ops
router.get('/:id', protect, validateObjectId, handleValidationErrors, getTenant);
router.put('/:id', protect, validateObjectId, validateTenantUpdate, handleValidationErrors, updateTenant);
router.delete('/:id', protect, validateObjectId, handleValidationErrors, deleteTenant);

// Logged-in tenant shortcuts
router.get('/me', protect, getMyTenant);
router.get('/me/history', protect, listMyHistory);

// History endpoints
router.get('/:id/history', protect, validateObjectId, handleValidationErrors, require('../controllers/tenantController').listHistory);
router.post('/:id/history', protect, validateObjectId, require('../middleware/validation').validateHistoryCreate, handleValidationErrors, require('../controllers/tenantController').addHistory);

// Transaction endpoints
router.get('/:id/transactions', protect, validateObjectId, handleValidationErrors, require('../controllers/tenantController').listTransactions);
router.post('/:id/transactions', protect, validateObjectId, require('../middleware/validation').validateTransactionCreate, handleValidationErrors, require('../controllers/tenantController').addTransaction);

// Avatar upload (admin for any tenant, or the tenant themselves)
router.post('/:id/avatar', protect, validateObjectId, handleValidationErrors, imageUpload.single('file'), uploadTenantAvatar);
router.post('/me/avatar', protect, imageUpload.single('file'), uploadMyAvatar);

// Multer error handler (JSON)
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes('Only')) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
});

module.exports = router;
