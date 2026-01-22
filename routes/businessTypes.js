const express = require('express');
const { body } = require('express-validator');
const { protect } = require('../middleware/auth');
const { handleValidationErrors } = require('../middleware/validation');
const {
    createBusinessType,
    getBusinessTypes,
    getBusinessType,
    getFeaturedBusinessTypes,
    updateBusinessType,
    deleteBusinessType
} = require('../controllers/businessTypeController');

const router = express.Router();

// Validation middleware
const validateBusinessType = [
    body('name')
        .trim()
        .isLength({ min: 2, max: 100 })
        .withMessage('Name must be between 2 and 100 characters'),
    body('description')
        .optional()
        .trim()
        .isLength({ max: 500 })
        .withMessage('Description cannot be more than 500 characters')
];

// Routes
router.get('/featured', getFeaturedBusinessTypes);
router.post('/', protect, validateBusinessType, handleValidationErrors, createBusinessType);
router.get('/', protect, getBusinessTypes);
router.get('/:id', protect, getBusinessType);
router.put('/:id', protect, validateBusinessType, handleValidationErrors, updateBusinessType);
router.delete('/:id', protect, deleteBusinessType);

module.exports = router;
