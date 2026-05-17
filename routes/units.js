const express = require('express');
const multer = require('multer');
const { protect } = require('../middleware/auth');
const {
  validateObjectId,
  handleValidationErrors
} = require('../middleware/validation');
const {
  createUnit,
  getEstateUnits,
  getVacantUnits,
  getUnitDetails,
  updateUnit,
  assignTenantToUnit,
  removeTenantFromUnit,
  getPublicListings,
  getPublicListingDetail,
  deleteUnit,
  uploadUnitImages,
  uploadUnitVideo,
  updateUnitMedia,
  removeUnitMedia,
} = require('../controllers/unitController');

const storage = multer.memoryStorage();

const imageUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10 MB per image
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only image files are allowed (jpeg, png, gif, webp)'));
  }
});

const videoUpload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/x-matroska'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only video files are allowed (mp4, mov, webm, avi, mkv)'));
  }
});

const router = express.Router();

// Public routes (no auth)
router.get('/public/listings', getPublicListings);
router.get('/public/listings/:id', getPublicListingDetail);

// Create unit for an estate
router.post('/:estateId/units', protect, validateObjectId('estateId'), handleValidationErrors, createUnit);

// Get all units for an estate
router.get('/:estateId/units', protect, validateObjectId('estateId'), handleValidationErrors, getEstateUnits);

// Get vacant units for tenant assignment
router.get('/:estateId/units/vacant', protect, validateObjectId('estateId'), handleValidationErrors, getVacantUnits);

// Assign tenant to a unit
router.post('/:estateId/units/:unitId/assign-tenant', protect, validateObjectId('estateId'), validateObjectId('unitId'), handleValidationErrors, assignTenantToUnit);

// Remove tenant from a unit (make it vacant)
router.post('/:estateId/units/:unitId/remove-tenant', protect, validateObjectId('estateId'), validateObjectId('unitId'), handleValidationErrors, removeTenantFromUnit);

// Get a single unit (by id)
router.get('/unit/:unitId', protect, validateObjectId('unitId'), handleValidationErrors, getUnitDetails);

// Update a unit (pricing & info)
router.put('/unit/:unitId', protect, validateObjectId('unitId'), handleValidationErrors, updateUnit);

// Delete a unit (soft delete)
router.delete('/unit/:unitId', protect, validateObjectId('unitId'), handleValidationErrors, deleteUnit);

// --- Unit Media Endpoints ---
// Upload images directly (multipart, field: "images", up to 10 files)
router.post('/unit/:unitId/media/images', protect, validateObjectId('unitId'), handleValidationErrors, imageUpload.array('images', 10), uploadUnitImages);

// Upload a single video directly (multipart, field: "video")
router.post('/unit/:unitId/media/videos', protect, validateObjectId('unitId'), handleValidationErrors, videoUpload.single('video'), uploadUnitVideo);

// Update media from JSON body (after uploading via /api/upload/image or /api/upload/video)
router.patch('/unit/:unitId/media', protect, validateObjectId('unitId'), handleValidationErrors, updateUnitMedia);

// Remove specific images/videos by publicId (also deletes from Cloudinary)
router.delete('/unit/:unitId/media', protect, validateObjectId('unitId'), handleValidationErrors, removeUnitMedia);

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes('Only')) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
});

module.exports = router;
