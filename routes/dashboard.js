const express = require('express');
const router = express.Router();

const { protect } = require('../middleware/auth');
const { getOverview } = require('../controllers/dashboardController');

/**
 * Dashboard Routes
 * All endpoints require authentication
 */

// Get overview - returns different data based on user role
router.get('/overview', protect, getOverview);

module.exports = router;
