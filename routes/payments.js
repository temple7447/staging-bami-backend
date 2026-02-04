const express = require('express');
const { protect } = require('../middleware/auth');
const {
  validateObjectId,
  handleValidationErrors
} = require('../middleware/validation');
const {
  initiateInitialPayment,
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
  recordManualPayment,
  downloadPaymentReceipt,
  refundDeposit,
  sendPaymentReceipt,
  sendTenantReceipt
} = require('../controllers/paymentController');

const router = express.Router();

// ... existing routes ...

// Download receipt directly
router.get('/:paymentId/download', protect, handleValidationErrors, downloadPaymentReceipt);

// Payment initiation endpoints
router.post('/initial', protect, initiateInitialPayment);
router.post('/deposit', protect, initiateDepositPayment);
router.post('/rent', protect, initiateRentPayment);
router.post('/service-charge', protect, initiateServiceChargePayment);
router.post('/security-charge', protect, initiateSecurityChargePayment);
router.post('/caution-fee', protect, initiateCautionFeePayment);
router.post('/legal-fee', protect, initiateLegalFeePayment);

// Manual payment recording (Admin only)
router.post('/manual-record', protect, recordManualPayment);
// Get payment status
router.get('/:paymentId', protect, handleValidationErrors, getPaymentStatus);

// Get all payments for a tenant
router.get('/tenant/:tenantId', protect, validateObjectId('tenantId'), handleValidationErrors, getTenantPayments);

// Get all payments for an estate
router.get('/estate/:estateId', protect, validateObjectId('estateId'), handleValidationErrors, getEstatePayments);

// Payment callback (webhook)
router.post('/callback', (req, res) => {
  // Paystack webhook callback - can be extended for multiple payment providers
  res.status(200).json({ success: true, message: 'Callback received' });
});

// Verify payment (called from frontend after Paystack checkout)
router.get('/verify/:reference', verifyPayment);

// Refund deposit
router.post('/:paymentId/refund', protect, handleValidationErrors, refundDeposit);

// Send receipt email by tenant ID (alternative endpoint) - MUST come before /:paymentId/receipt
router.post('/tenant/:tenantId/receipt', protect, validateObjectId('tenantId'), handleValidationErrors, sendTenantReceipt);

// Send receipt email by payment ID
router.post('/:paymentId/receipt', protect, handleValidationErrors, sendPaymentReceipt);

module.exports = router;
