const express = require('express');
const { protect } = require('../middleware/auth');
const {
  validateObjectId,
  handleValidationErrors
} = require('../middleware/validation');
const {
  initiateDepositPayment,
  initiateRentPayment,
  initiateServiceChargePayment,
  initiateSecurityChargePayment,
  initiateCautionFeePayment,
  initiateLegalFeePayment,
  verifyPayment,
  getPaymentStatus,
  getTenantPayments,
  getEstatePayments,
  refundDeposit
} = require('../controllers/paymentController');

const router = express.Router();

// Payment initiation endpoints
router.post('/deposit', protect, initiateDepositPayment);
router.post('/rent', protect, initiateRentPayment);
router.post('/service-charge', protect, initiateServiceChargePayment);
router.post('/security-charge', protect, initiateSecurityChargePayment);
router.post('/caution-fee', protect, initiateCautionFeePayment);
router.post('/legal-fee', protect, initiateLegalFeePayment);

// Get payment status
router.get('/:paymentId', protect, validateObjectId, handleValidationErrors, getPaymentStatus);

// Get all payments for a tenant
router.get('/tenant/:tenantId', protect, validateObjectId, handleValidationErrors, getTenantPayments);

// Get all payments for an estate
router.get('/estate/:estateId', protect, validateObjectId, handleValidationErrors, getEstatePayments);

// Payment callback (webhook)
router.post('/callback', (req, res) => {
  // Paystack webhook callback - can be extended for multiple payment providers
  res.status(200).json({ success: true, message: 'Callback received' });
});

// Verify payment (called from frontend after Paystack checkout)
router.get('/verify/:reference', verifyPayment);

// Refund deposit
router.post('/:paymentId/refund', protect, validateObjectId, handleValidationErrors, refundDeposit);

module.exports = router;
