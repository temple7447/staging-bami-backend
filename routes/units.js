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
  getUnitDetails,
  updateUnit,
  assignTenantToUnit,
  removeTenantFromUnit,
  getPublicListings,
  getPublicListingDetail,
} = require('../controllers/unitController');

const router = express.Router();

// Public routes (no auth)
router.get('/public/listings', getPublicListings);
router.get('/public/listings/:id', getPublicListingDetail);

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

// Get a single unit (by id)
router.get('/unit/:unitId', protect, validateObjectId('unitId'), handleValidationErrors, getUnitDetails);

// Update a unit (pricing & info)
router.put('/unit/:unitId', protect, validateObjectId('unitId'), handleValidationErrors, updateUnit);

module.exports = router;
