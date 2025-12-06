const express = require('express');
const { protect } = require('../middleware/auth');
const {
    validateObjectId,
    handleValidationErrors
} = require('../middleware/validation');
const {
    createSubscription,
    getAllSubscriptions,
    getSubscriptionById,
    updateSubscription,
    deleteSubscription
} = require('../controllers/subscriptionController');

const router = express.Router();

/**
 * @swagger
 * components:
 *   schemas:
 *     Subscription:
 *       type: object
 *       required:
 *         - name
 *         - price
 *         - billingPeriod
 *       properties:
 *         _id:
 *           type: string
 *         name:
 *           type: string
 *           example: Premium Hosting
 *         price:
 *           type: number
 *           example: 99
 *         billingPeriod:
 *           type: string
 *           enum: [month, year, week, day, one-time]
 *           example: month
 *         description:
 *           type: string
 *           example: Brief description of the subscription
 *         icon:
 *           type: string
 *           enum: [Layout (Frontend), Server (Backend)]
 *           example: Layout (Frontend)
 *         status:
 *           type: string
 *           enum: [Active, Inactive]
 *           example: Active
 *         features:
 *           type: array
 *           items:
 *             type: string
 *           example: [Global CDN, Unlimited Bandwidth, DDoS Protection]
 *         createdAt:
 *           type: string
 *           format: date-time
 *         updatedAt:
 *           type: string
 *           format: date-time
 */

/**
 * @swagger
 * /api/subscriptions:
 *   post:
 *     summary: Create a new subscription plan
 *     tags: [Subscriptions]
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
 *               - price
 *               - billingPeriod
 *             properties:
 *               name:
 *                 type: string
 *                 example: Premium Hosting
 *               price:
 *                 type: number
 *                 example: 99
 *               billingPeriod:
 *                 type: string
 *                 enum: [month, year, week, day, one-time]
 *                 example: month
 *               description:
 *                 type: string
 *                 example: Brief description of the subscription
 *               icon:
 *                 type: string
 *                 enum: [Layout (Frontend), Server (Backend)]
 *                 example: Layout (Frontend)
 *               status:
 *                 type: string
 *                 enum: [Active, Inactive]
 *                 example: Active
 *               features:
 *                 oneOf:
 *                   - type: string
 *                     example: "Global CDN\nUnlimited Bandwidth\nDDoS Protection"
 *                   - type: array
 *                     items:
 *                       type: string
 *                     example: [Global CDN, Unlimited Bandwidth, DDoS Protection]
 *     responses:
 *       201:
 *         description: Subscription created successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Subscription'
 *       400:
 *         description: Validation error
 *       401:
 *         description: Unauthorized
 */
// Create a new subscription (admin only)
router.post('/', protect, createSubscription);

/**
 * @swagger
 * /api/subscriptions:
 *   get:
 *     summary: Get all subscription plans
 *     tags: [Subscriptions]
 *     parameters:
 *       - in: query
 *         name: status
 *         schema:
 *           type: string
 *           enum: [Active, Inactive]
 *         description: Filter by subscription status
 *       - in: query
 *         name: billingPeriod
 *         schema:
 *           type: string
 *           enum: [month, year, week, day, one-time]
 *         description: Filter by billing period
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
 *     responses:
 *       200:
 *         description: List of subscriptions
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/Subscription'
 *                 pagination:
 *                   type: object
 *                   properties:
 *                     currentPage:
 *                       type: integer
 *                     totalPages:
 *                       type: integer
 *                     totalItems:
 *                       type: integer
 */
// Get all subscriptions
router.get('/', getAllSubscriptions);

/**
 * @swagger
 * /api/subscriptions/{id}:
 *   get:
 *     summary: Get subscription by ID
 *     tags: [Subscriptions]
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Subscription ID
 *     responses:
 *       200:
 *         description: Subscription details
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 data:
 *                   $ref: '#/components/schemas/Subscription'
 *       404:
 *         description: Subscription not found
 */
// Get subscription by ID
router.get('/:id', validateObjectId('id'), handleValidationErrors, getSubscriptionById);

/**
 * @swagger
 * /api/subscriptions/{id}:
 *   put:
 *     summary: Update subscription plan
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Subscription ID
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               name:
 *                 type: string
 *               price:
 *                 type: number
 *               billingPeriod:
 *                 type: string
 *                 enum: [month, year, week, day, one-time]
 *               description:
 *                 type: string
 *               icon:
 *                 type: string
 *                 enum: [Layout (Frontend), Server (Backend)]
 *               status:
 *                 type: string
 *                 enum: [Active, Inactive]
 *               features:
 *                 oneOf:
 *                   - type: string
 *                   - type: array
 *                     items:
 *                       type: string
 *     responses:
 *       200:
 *         description: Subscription updated successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *                 data:
 *                   $ref: '#/components/schemas/Subscription'
 *       404:
 *         description: Subscription not found
 *       401:
 *         description: Unauthorized
 */
// Update subscription (admin only)
router.put('/:id', protect, validateObjectId('id'), handleValidationErrors, updateSubscription);

/**
 * @swagger
 * /api/subscriptions/{id}:
 *   delete:
 *     summary: Delete subscription plan (soft delete)
 *     tags: [Subscriptions]
 *     security:
 *       - bearerAuth: []
 *     parameters:
 *       - in: path
 *         name: id
 *         required: true
 *         schema:
 *           type: string
 *         description: Subscription ID
 *     responses:
 *       200:
 *         description: Subscription deleted successfully
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 success:
 *                   type: boolean
 *                 message:
 *                   type: string
 *       404:
 *         description: Subscription not found
 *       401:
 *         description: Unauthorized
 */
// Delete subscription (admin only)
router.delete('/:id', protect, validateObjectId('id'), handleValidationErrors, deleteSubscription);

module.exports = router;
