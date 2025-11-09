const express = require('express');
const multer = require('multer');
const { protect } = require('../middleware/auth');
const { uploadSingleImage, uploadSingleVideo } = require('../controllers/uploadController');

// Use in-memory storage; we'll upload buffers directly to Cloudinary
const storage = multer.memoryStorage();

// Multer instances with file filters and size limits
const imageUpload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB for images
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp', 'image/svg+xml'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only image files are allowed'));
  }
});

const videoUpload = multer({
  storage,
  limits: { fileSize: 200 * 1024 * 1024 }, // 200MB for videos (adjust as needed)
  fileFilter: (req, file, cb) => {
    const allowed = [
      'video/mp4',
      'video/quicktime', // .mov
      'video/webm',
      'video/x-msvideo', // .avi
      'video/x-matroska', // .mkv
      'video/3gpp',
    ];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only video files are allowed'));
  }
});

const router = express.Router();

// POST /api/upload/image - upload a single image to Cloudinary
router.post('/image', protect, imageUpload.single('file'), uploadSingleImage);

// POST /api/upload/video - upload a single video to Cloudinary
router.post('/video', protect, videoUpload.single('file'), uploadSingleVideo);

// Graceful error handling for Multer errors so we return JSON consistently
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes('Only')) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
});

module.exports = router;
