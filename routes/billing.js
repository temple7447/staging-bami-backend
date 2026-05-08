const express = require('express');
const { protect, adminOrSuperAdmin } = require('../middleware/auth');
const {
    validateObjectId,
    handleValidationErrors
} = require('../middleware/validation');
const {
    createBillingItem,
    getBillingItems,
    updateBillingItem,
    deleteBillingItem,
    getBillingSummary
} = require('../controllers/billingController');

const router = express.Router();

// Unified billing summary — all roles, single endpoint
router.get('/summary', protect, getBillingSummary);

// Admin routes for managing billing items
router.post('/tenants/:tenantId/billing', protect, adminOrSuperAdmin, validateObjectId('tenantId'), handleValidationErrors, createBillingItem);
router.get('/tenants/:tenantId/billing', protect, adminOrSuperAdmin, validateObjectId('tenantId'), handleValidationErrors, getBillingItems);
router.put('/:itemId', protect, adminOrSuperAdmin, validateObjectId('itemId'), handleValidationErrors, updateBillingItem);
router.delete('/:itemId', protect, adminOrSuperAdmin, validateObjectId('itemId'), handleValidationErrors, deleteBillingItem);

module.exports = router;
