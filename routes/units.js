const express = require('express');
const { protect } = require('../middleware/auth');
const {
  validateObjectId,
  handleValidationErrors
} = require('../middleware/validation');
const {
  createUnit,
  getEstateUnits,
  getVacantUnits,
  assignTenantToUnit,
  removeTenantFromUnit,
} = require('../controllers/unitController');

const router = express.Router();

// Create unit for an estate
router.post('/:estateId/units', protect, validateObjectId('estateId'), handleValidationErrors, createUnit);

// Get all units for an estate
router.get('/:estateId/units', protect, validateObjectId('estateId'), handleValidationErrors, getEstateUnits);

// Get vacant units for tenant assignment
router.get('/:estateId/units/vacant', protect, validateObjectId('estateId'), handleValidationErrors, getVacantUnits);

// Assign tenant to a unit
router.post('/:estateId/units/:unitId/assign-tenant', protect, validateObjectId('estateId'), validateObjectId('unitId'), handleValidationErrors, assignTenantToUnit);

// Remove tenant from a unit (make it vacant)
router.post('/:estateId/units/:unitId/remove-tenant', protect, validateObjectId('estateId'), validateObjectId('unitId'), handleValidationErrors, removeTenantFromUnit);

module.exports = router;
