const express = require('express');
const { protect } = require('../middleware/auth');
const { validateObjectId, handleValidationErrors } = require('../middleware/validation');
const {
  submitEnquiry,
  getEnquiries,
  getEnquiry,
  updateEnquiryStatus,
  deleteEnquiry
} = require('../controllers/enquiryController');

const router = express.Router();

// Public — no auth required
router.post('/', submitEnquiry);

// Protected — owner/admin only
router.get('/', protect, getEnquiries);
router.get('/:id', protect, validateObjectId('id'), handleValidationErrors, getEnquiry);
router.patch('/:id/status', protect, validateObjectId('id'), handleValidationErrors, updateEnquiryStatus);
router.delete('/:id', protect, validateObjectId('id'), handleValidationErrors, deleteEnquiry);

module.exports = router;
