const express = require('express');
const multer = require('multer');
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
  getOverallEstateOverview,
  uploadEstateImages,
  updateEstateMedia,
  removeEstateMedia,
} = require('../controllers/estateController');

const imageUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
    if (allowed.includes(file.mimetype)) return cb(null, true);
    cb(new Error('Only image files are allowed (jpeg, png, gif, webp)'));
  }
});

const router = express.Router();


/**
 * @swagger
 * /api/estates/overview/all:
 *   get:
 *     summary: Get overall estate overview with aggregated statistics and filters
 *     tags: [Estates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [today, week, month, quarter, year, custom, Q1, Q2, Q3, Q4, 6_months]
 *         description: Predefined time period
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: Specific year (e.g., 2024)
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         description: Specific month (1-12)
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Custom start date (ISO format, requires period=custom)
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *         description: Custom end date (ISO format, requires period=custom)
 *       - in: query
 *         name: estateIds
 *         schema:
 *           type: string
 *         description: Comma-separated estate IDs to filter
 *       - in: query
 *         name: unitStatus
 *         schema:
 *           type: string
 *           enum: [occupied, vacant, maintenance, reserved]
 *         description: Filter units by status
 *       - in: query
 *         name: tenantStatus
 *         schema:
 *           type: string
 *           enum: [occupied, pending, vacant, evicted]
 *         description: Filter tenants by status
 *       - in: query
 *         name: paymentStatus
 *         schema:
 *           type: string
 *           enum: [completed, pending, initiated, failed]
 *         description: Filter payments by status
 *     responses:
 *       200:
 *         description: Overall statistics across all estates
 *       401:
 *         description: Unauthorized
 */
router.get('/overview/all', protect, getOverallEstateOverview);

/**
 * @swagger
 * /api/estates:
 *   get:
 *     summary: List all estates with sorting and filters
 *     tags: [Estates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *         description: Page number
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *         description: Items per page
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
 *         description: Search estates by name
 *       - in: query
 *         name: sortBy
 *         schema:
 *           type: string
 *           enum: [name, createdAt, totalUnits]
 *           default: createdAt
 *         description: Field to sort by
 *       - in: query
 *         name: order
 *         schema:
 *           type: string
 *           enum: [asc, desc]
 *           default: desc
 *         description: Sort order
 *       - in: query
 *         name: minUnits
 *         schema:
 *           type: integer
 *         description: Minimum number of total units
 *       - in: query
 *         name: maxUnits
 *         schema:
 *           type: integer
 *         description: Maximum number of total units
 *       - in: query
 *         name: createdAfter
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter estates created after this date
 *       - in: query
 *         name: createdBefore
 *         schema:
 *           type: string
 *           format: date
 *         description: Filter estates created before this date
 *     responses:
 *       200:
 *         description: List of estates
 *       401:
 *         description: Unauthorized
 */
router.get('/', protect, getEstates);

/**
 * @swagger
 * /api/estates:
 *   post:
 *     summary: Create a new estate
 *     tags: [Estates]
 *     security:
 *       - bearerAuth: []
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required:
 *               - name
 *               - totalUnits
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               totalUnits:
 *                 type: integer
 *     responses:
 *       201:
 *         description: Estate created successfully
 *       400:
 *         description: Validation error
 */
router.post('/', protect, validateEstateCreate, handleValidationErrors, createEstate);

/**
 * @swagger
 * /api/estates/{id}/overview:
 *   get:
 *     summary: Get estate overview with statistics
 *     tags: [Estates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *       - in: query
 *         name: period
 *         schema:
 *           type: string
 *           enum: [today, week, month, quarter, year, custom, Q1, Q2, Q3, Q4, 6_months]
 *         description: Predefined time period
 *       - in: query
 *         name: year
 *         schema:
 *           type: integer
 *         description: Specific year
 *       - in: query
 *         name: month
 *         schema:
 *           type: integer
 *           minimum: 1
 *           maximum: 12
 *         description: Specific month
 *       - in: query
 *         name: startDate
 *         schema:
 *           type: string
 *           format: date
 *       - in: query
 *         name: endDate
 *         schema:
 *           type: string
 *           format: date
 *     responses:
 *       200:
 *         description: Estate overview with occupancy and billing info
 *       404:
 *         description: Estate not found
 */
router.get('/:id/overview', protect, validateObjectId('id'), handleValidationErrors, getEstateOverview);

/**
 * @swagger
 * /api/estates/{id}:
 *   get:
 *     summary: Get single estate details
 *     tags: [Estates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Estate details
 *       404:
 *         description: Estate not found
 */
router.get('/:id', protect, validateObjectId('id'), handleValidationErrors, getEstate);


/**
 * @swagger
 * /api/estates/{id}:
 *   put:
 *     summary: Update estate details
 *     tags: [Estates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               description:
 *                 type: string
 *               totalUnits:
 *                 type: integer
 *     responses:
 *       200:
 *         description: Estate updated successfully
 *       404:
 *         description: Estate not found
 */
router.put('/:id', protect, validateObjectId('id'), validateEstateUpdate, handleValidationErrors, updateEstate);

/**
 * @swagger
 * /api/estates/{id}:
 *   delete:
 *     summary: Delete estate (soft delete)
 *     tags: [Estates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *     responses:
 *       200:
 *         description: Estate deleted successfully
 *       404:
 *         description: Estate not found
 */
router.delete('/:id', protect, validateObjectId('id'), handleValidationErrors, deleteEstate);

// --- Estate Image Endpoints ---
// Upload images directly (multipart, field: "images", up to 10 files)
router.post('/:id/media/images', protect, validateObjectId('id'), handleValidationErrors, imageUpload.array('images', 10), uploadEstateImages);

// Attach images by URL (after uploading via /api/upload/image)
router.patch('/:id/media', protect, validateObjectId('id'), handleValidationErrors, updateEstateMedia);

// Remove images by publicId (also deletes from Cloudinary)
router.delete('/:id/media', protect, validateObjectId('id'), handleValidationErrors, removeEstateMedia);

// Multer error handler
router.use((err, req, res, next) => {
  if (err instanceof multer.MulterError || err.message?.includes('Only')) {
    return res.status(400).json({ success: false, message: err.message });
  }
  next(err);
});

module.exports = router;
