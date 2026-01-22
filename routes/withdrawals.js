const express = require('express');
const { protect, authorize } = require('../middleware/auth');
const {
    requestWithdrawal,
    getMyWithdrawals,
    updateWithdrawalStatus
} = require('../controllers/withdrawalController');

const router = express.Router();

router.use(protect);

// Request a withdrawal
router.post('/request', requestWithdrawal);

// Get current user's withdrawals
router.get('/my', getMyWithdrawals);

// Admin/Super Admin only: Update status (Approve/Reject/Complete)
router.put('/:id/status', authorize('admin', 'super_admin'), updateWithdrawalStatus);

module.exports = router;
