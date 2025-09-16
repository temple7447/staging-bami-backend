const express = require('express');
const {
  getCategories,
  getCategory,
  createCategory,
  updateCategory,
  deleteCategory,
  reorderCategories,
  getCategoryStats,
  initializeDefaultCategories
} = require('../controllers/categoryController');

const { protect, superAdminOnly } = require('../middleware/auth');
const {
  validateCategoryCreation,
  validateCategoryUpdate,
  validateObjectId,
  handleValidationErrors
} = require('../middleware/validation');

const router = express.Router();

// Public routes (with authentication)
router.get('/', protect, getCategories);
router.get('/stats', protect, getCategoryStats);
router.get('/:id', protect, validateObjectId, handleValidationErrors, getCategory);

// Protected routes - Admin/Super Admin only
router.post(
  '/',
  protect,
  validateCategoryCreation,
  handleValidationErrors,
  createCategory
);

router.put(
  '/:id',
  protect,
  validateObjectId,
  validateCategoryUpdate,
  handleValidationErrors,
  updateCategory
);

router.delete(
  '/:id',
  protect,
  validateObjectId,
  handleValidationErrors,
  deleteCategory
);

router.put(
  '/reorder',
  protect,
  reorderCategories
);

// Super Admin only routes
router.post(
  '/init-defaults',
  protect,
  superAdminOnly,
  initializeDefaultCategories
);

module.exports = router;