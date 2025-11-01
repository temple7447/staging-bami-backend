const express = require('express');
const { protect } = require('../middleware/auth');
const {
  validateObjectId,
  handleValidationErrors,
  validateEstateCreate,
  validateEstateUpdate,
} = require('../middleware/validation');
const {
  createEstate,
  getEstates,
  getEstate,
  updateEstate,
  deleteEstate,
  getEstateOverview,
} = require('../controllers/estateController');

const router = express.Router();

// List estates
router.get('/', protect, getEstates);

// Estate overview
router.get('/:id/overview', protect, validateObjectId, handleValidationErrors, getEstateOverview);

// Get single estate
router.get('/:id', protect, validateObjectId, handleValidationErrors, getEstate);

// Create estate
router.post('/', protect, validateEstateCreate, handleValidationErrors, createEstate);

// Update estate
router.put('/:id', protect, validateObjectId, validateEstateUpdate, handleValidationErrors, updateEstate);

// Delete estate (soft)
router.delete('/:id', protect, validateObjectId, handleValidationErrors, deleteEstate);

module.exports = router;
