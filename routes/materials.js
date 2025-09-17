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

// FormData example for uploading from web/mobile:
// - Content-Type: multipart/form-data
// - File field name MUST be "file" (unless using a remote video URL)
// - Other fields sent as form fields (strings). Arrays = comma-separated strings.
//
// Required/typical fields:
//   file (file)                 -> binary document (PDF, docx, mp4, etc.) OR
//   videoUrl (string)           -> remote video URL (when materialType === "video", you may send videoUrl instead of a file)
//   title (string)              -> "Intro to Product Strategy"
//   category (string)           -> MongoDB category _id, e.g. "60f7c5e1abcd1234abcd1234"
//   materialType (string)       -> e.g. "document" | "video" | "audio" | "link"
//
// Example curl for remote video (no file upload):
// curl -X POST "https://your-api.example.com/api/materials" \
//   -H "Authorization: Bearer <JWT_TOKEN>" \
//   -F "videoUrl=https://videos.example.com/path/to/video.mp4" \
//   -F "title=Intro to Product Strategy" \
//   -F "category=60f7c5e1abcd1234abcd1234" \
//   -F "materialType=video"
//
// React Native example (remote video):
// const data = new FormData();
// data.append('videoUrl', 'https://videos.example.com/path/to/video.mp4');
// data.append('title', 'Intro to Product Strategy');
// data.append('category', '60f7c5e1abcd1234abcd1234');
// data.append('materialType', 'video');
// fetch('https://your-api.example.com/api/materials', {
//   method: 'POST',
//   headers: { 'Authorization': 'Bearer <JWT_TOKEN>' }, // DO NOT set Content-Type manually
//   body: data
// });
//
// The server expects multer to populate req.file.path (temporary file) and other form fields in req.body.

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