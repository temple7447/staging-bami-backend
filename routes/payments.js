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
  initiateCautionFeePayment,
  initiateLegalFeePayment,
  verifyPayment,
  getPaymentStatus,
  getTenantPayments,
  getEstatePayments,
  getAllPayments,
  recordManualPayment,
  downloadPaymentReceipt,
  refundDeposit,
  sendPaymentReceipt,
  sendTenantReceipt,
  getTenantReceipts
} = require('../controllers/paymentController');

const router = express.Router();

// Admin: all payments across managed estates (must be before /:paymentId)
router.get('/', protect, getAllPayments);

// Download receipt directly
router.get('/:paymentId/download', protect, handleValidationErrors, downloadPaymentReceipt);

// Payment initiation endpoints
router.post('/initial', protect, initiateInitialPayment);
router.post('/deposit', protect, initiateDepositPayment);
router.post('/rent', protect, initiateRentPayment);
router.post('/service-charge', protect, initiateServiceChargePayment);
router.post('/caution-fee', protect, initiateCautionFeePayment);
router.post('/legal-fee', protect, initiateLegalFeePayment);

// Manual payment recording (Admin only)
router.post('/manual-record', protect, recordManualPayment);

// Verify payment (called from frontend after Paystack checkout) — MUST be before /:paymentId
router.get('/verify/:reference', protect, verifyPayment);

// Get all payments for a tenant
router.get('/tenant/:tenantId', protect, validateObjectId('tenantId'), handleValidationErrors, getTenantPayments);

// Get all payments for an estate
router.get('/estate/:estateId', protect, validateObjectId('estateId'), handleValidationErrors, getEstatePayments);

// Payment callback (webhook)
router.post('/callback', (req, res) => {
  res.status(200).json({ success: true, message: 'Callback received' });
});

// Get all receipts for the logged-in tenant — MUST come before /:paymentId
router.get('/receipts', protect, getTenantReceipts);

// Get payment status — generic param route MUST come after all specific routes
router.get('/:paymentId', protect, handleValidationErrors, getPaymentStatus);

// Refund deposit
router.post('/:paymentId/refund', protect, handleValidationErrors, refundDeposit);

// Send receipt email by tenant ID (alternative endpoint) - MUST come before /:paymentId/receipt
router.post('/tenant/:tenantId/receipt', protect, validateObjectId('tenantId'), handleValidationErrors, sendTenantReceipt);

// Send receipt email by payment ID
router.post('/:paymentId/receipt', protect, handleValidationErrors, sendPaymentReceipt);

module.exports = router;
