const express = require('express');
const {
  getMaterials,
  getMaterial,
  uploadMaterial,
  updateMaterial,
  deleteMaterial,
  downloadMaterial,
  addNote,
  addHighlight,
  addReview,
  getMaterialStats
} = require('../controllers/materialController');

const { protect } = require('../middleware/auth');
const {
  validateMaterialUpload,
  validateMaterialUpdate,
  validateNote,
  validateHighlight,
  validateReview,
  validateObjectId,
  handleValidationErrors
} = require('../middleware/validation');

const { uploadSingle, handleUploadError } = require('../utils/fileUpload');

const router = express.Router();

// Public routes (with authentication)
router.get('/', protect, getMaterials);
router.get('/stats', protect, getMaterialStats);
router.get('/download/:filename', protect, downloadMaterial);
router.get('/:id', protect, validateObjectId, handleValidationErrors, getMaterial);

// Material management routes
router.post(
  '/',
  protect,
  uploadSingle,
  handleUploadError,
  validateMaterialUpload,
  handleValidationErrors,
  uploadMaterial
);

router.put(
  '/:id',
  protect,
  validateObjectId,
  validateMaterialUpdate,
  handleValidationErrors,
  updateMaterial
);

router.delete(
  '/:id',
  protect,
  validateObjectId,
  handleValidationErrors,
  deleteMaterial
);

// User interaction routes
router.post(
  '/:id/notes',
  protect,
  validateObjectId,
  validateNote,
  handleValidationErrors,
  addNote
);

router.post(
  '/:id/highlights',
  protect,
  validateObjectId,
  validateHighlight,
  handleValidationErrors,
  addHighlight
);

router.post(
  '/:id/reviews',
  protect,
  validateObjectId,
  validateReview,
  handleValidationErrors,
  addReview
);

module.exports = router;