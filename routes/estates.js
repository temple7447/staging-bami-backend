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

/**
 * @swagger
 * /api/estates:
 *   get:
 *     summary: List all estates
 *     tags: [Estates]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: query
 *         name: page
 *         schema:
 *           type: integer
 *           default: 1
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 20
 *       - in: query
 *         name: search
 *         schema:
 *           type: string
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

module.exports = router;
