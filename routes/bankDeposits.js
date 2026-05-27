const express = require('express');
const multer = require('multer');
const { protect, adminOrSuperAdmin } = require('../middleware/auth');
const {
  validateObjectId,
  handleValidationErrors
} = require('../middleware/validation');
const {
  getBankInfo,
  submitDeposit,
  getMyDeposits,
  getAllDeposits,
  getDeposit,
  approveDeposit,
  rejectDeposit
} = require('../controllers/bankDepositController');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/jpg'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  }
});

const router = express.Router();

// Public bank info (still requires auth — shown after login)
router.get('/bank-info', protect, getBankInfo);

// Tenant: submit deposit with proof image
router.post('/', protect, upload.single('proof'), submitDeposit);

// Tenant: view own deposit history
router.get('/my', protect, getMyDeposits);

// Admin: view all deposits
router.get('/', protect, adminOrSuperAdmin, getAllDeposits);

// Get single deposit (admin or owner)
router.get('/:id', protect, validateObjectId('id'), handleValidationErrors, getDeposit);

// Admin: approve deposit
router.patch('/:id/approve', protect, adminOrSuperAdmin, validateObjectId('id'), handleValidationErrors, approveDeposit);

// Admin: reject deposit
router.patch('/:id/reject', protect, adminOrSuperAdmin, validateObjectId('id'), handleValidationErrors, rejectDeposit);

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes('Only')) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
});

module.exports = router;
