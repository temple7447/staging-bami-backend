const express = require('express');
const multer = require('multer');
const { protect } = require('../middleware/auth');
const {
    createIssue,
    getIssues,
    getIssue,
    updateIssueStatus,
    assignIssue,
    cancelIssue
} = require('../controllers/issueController');

const storage = multer.memoryStorage();

// Accept images (up to 5) and videos (up to 2) in one request
const mediaUpload = multer({
    storage,
    limits: { fileSize: 200 * 1024 * 1024 }, // 200MB ceiling (videos)
    fileFilter: (req, file, cb) => {
        const allowedImages = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
        const allowedVideos = ['video/mp4', 'video/quicktime', 'video/webm', 'video/x-msvideo', 'video/3gpp'];
        if (allowedImages.includes(file.mimetype) || allowedVideos.includes(file.mimetype)) {
            return cb(null, true);
        }
        cb(new Error('Only image (jpeg, png, gif, webp) and video (mp4, mov, webm, avi) files are allowed'));
    }
}).fields([
    { name: 'images', maxCount: 5 },
    { name: 'videos', maxCount: 2 }
]);

const router = express.Router();

router.use(protect);

// Report a new issue (with optional image/video media)
router.post('/', mediaUpload, createIssue);

// List issues (role-filtered)
router.get('/', getIssues);

// Get a single issue with full timeline
router.get('/:id', getIssue);

// Advance stage with optional proof media
router.patch('/:id/status', mediaUpload, updateIssueStatus);

// Assign issue to a user (admin only)
router.patch('/:id/assign', assignIssue);

// Cancel / soft-delete an issue
router.delete('/:id', cancelIssue);

// Multer error handler
router.use((err, req, res, next) => {
    if (err instanceof multer.MulterError || err.message?.includes('Only')) {
        return res.status(400).json({ success: false, message: err.message });
    }
    next(err);
});

module.exports = router;
