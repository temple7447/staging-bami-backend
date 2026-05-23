const express = require('express');
const { protect } = require('../middleware/auth');
const { validateObjectId, handleValidationErrors } = require('../middleware/validation');
const {
  submitApplication,
  getApplications,
  getApplication,
  updateApplicationStatus,
  deleteApplication
} = require('../controllers/rentalApplicationController');

const router = express.Router();

// Public — anyone can submit
router.post('/', submitApplication);

// Protected — owner/admin views
router.get('/', protect, getApplications);
router.get('/:id', protect, validateObjectId('id'), handleValidationErrors, getApplication);
router.patch('/:id/status', protect, validateObjectId('id'), handleValidationErrors, updateApplicationStatus);
router.delete('/:id', protect, validateObjectId('id'), handleValidationErrors, deleteApplication);

module.exports = router;
