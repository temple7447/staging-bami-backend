const express = require('express');
const router = express.Router({ mergeParams: true });

const { protect } = require('../middleware/auth');
const {
  validateObjectId,
  handleValidationErrors,
  validateTenantCreate,
  validateTenantUpdate,
} = require('../middleware/validation');

const {
  createTenant,
  getTenants,
  getTenant,
  updateTenant,
  deleteTenant,
} = require('../controllers/tenantController');

// Nested: /api/estates/:estateId/tenants (list/create for a given estate)
router.get('/', protect, getTenants);
router.post('/', protect, validateTenantCreate, handleValidationErrors, createTenant);

// Non-nested: /api/tenants (list all)
// When mounted at /api/tenants, estateId is undefined so returns all

// Single tenant ops
router.get('/:id', protect, validateObjectId, handleValidationErrors, getTenant);
router.put('/:id', protect, validateObjectId, validateTenantUpdate, handleValidationErrors, updateTenant);
router.delete('/:id', protect, validateObjectId, handleValidationErrors, deleteTenant);

// History endpoints
router.get('/:id/history', protect, validateObjectId, handleValidationErrors, require('../controllers/tenantController').listHistory);
router.post('/:id/history', protect, validateObjectId, require('../middleware/validation').validateHistoryCreate, handleValidationErrors, require('../controllers/tenantController').addHistory);

// Transaction endpoints
router.get('/:id/transactions', protect, validateObjectId, handleValidationErrors, require('../controllers/tenantController').listTransactions);
router.post('/:id/transactions', protect, validateObjectId, require('../middleware/validation').validateTransactionCreate, handleValidationErrors, require('../controllers/tenantController').addTransaction);

module.exports = router;
