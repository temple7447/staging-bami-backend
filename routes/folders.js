const express = require('express');
const {
  getFolders,
  getFolder,
  createFolder,
  updateFolder,
  deleteFolder,
  moveFolder,
  getFolderStats,
  getFoldersForMaterials
} = require('../controllers/folderController');

const { protect } = require('../middleware/auth');
const {
  validateFolderCreation,
  validateFolderUpdate,
  validateFolderMove,
  validateObjectId,
  handleValidationErrors
} = require('../middleware/validation');

const router = express.Router();

/**
 * @desc    Get all folders with hierarchical structure
 * @route   GET /api/folders
 * @access  Private
 * @params  ?flat=true - Return flat list instead of tree
 *          ?view=tree|flat|dropdown - Display format
 *          ?parent=id - Get folders for specific parent
 *          ?level=0|1|2 - Get folders at specific level
 *          ?includeStats=true - Include material statistics
 * 
 * Examples:
 * - GET /api/folders - Get hierarchical tree (default)
 * - GET /api/folders?view=dropdown - Get flat list for dropdowns
 * - GET /api/folders?level=0 - Get only parent folders
 * - GET /api/folders?parent=null - Get root folders
 * - GET /api/folders?parent=folder_id - Get children of specific folder
 * - GET /api/folders?includeStats=true - Include material counts and sizes
 */
router.get('/', protect, getFolders);

/**
 * @desc    Get folder statistics
 * @route   GET /api/folders/stats
 * @access  Private
 * @returns Overview stats, level distribution, and top folders by material count
 */
router.get('/stats', protect, getFolderStats);

/**
 * @desc    Get folders that can contain materials (grandchild folders only)
 * @route   GET /api/folders/for-materials
 * @access  Private
 * @returns Only level 2 folders (grandchildren) where materials can be placed
 */
router.get('/for-materials', protect, getFoldersForMaterials);

/**
 * @desc    Get single folder with details
 * @route   GET /api/folders/:id
 * @access  Private
 * @params  ?includeStats=true - Include material statistics
 *          ?includeMaterials=true - Include materials list (for grandchild folders)
 * 
 * Returns folder details plus:
 * - folderPath: Breadcrumb navigation array
 * - subfolders: Direct child folders
 * - canHaveSubfolders: Boolean indicating if can contain subfolders
 * - canHaveMaterials: Boolean indicating if can contain materials
 * - folderType: 'parent'|'child'|'grandchild'
 * - materials: Array of materials (if includeMaterials=true and level=2)
 */
router.get(
  '/:id', 
  protect, 
  validateObjectId, 
  handleValidationErrors, 
  getFolder
);

/**
 * @desc    Create new folder
 * @route   POST /api/folders
 * @access  Private
 * @body    {
 *            "name": "Folder Name",
 *            "description": "Optional description",
 *            "parentFolder": "parent_folder_id", // null for root level
 *            "icon": "folder", // optional, default: 'folder'
 *            "color": "#6C757D", // optional, hex color
 *            "order": 0, // optional, for sorting
 *            "visibility": "public", // optional: public|managers_only|owner_only|role_specific
 *            "allowedRoles": [], // optional array of roles if visibility=role_specific
 *            "allowMaterials": true, // optional, auto-set based on level
 *            "isProtected": false // optional, prevents deletion if contains materials
 *          }
 * 
 * Validation Rules:
 * - Parent folder must exist and be active
 * - Maximum 3 levels of hierarchy (parent → child → grandchild)
 * - Folder name must be unique within the same parent
 * - Parent folders (level 0,1) can have subfolders
 * - Grandchild folders (level 2) can contain materials
 */
router.post(
  '/',
  protect,
  validateFolderCreation,
  handleValidationErrors,
  createFolder
);

/**
 * @desc    Update folder
 * @route   PUT /api/folders/:id
 * @access  Private
 * @body    Same as create, all fields optional
 * 
 * Additional Validation:
 * - Cannot create circular references (set descendant as parent)
 * - Cannot move folder beyond 3-level limit
 * - Name must be unique within target parent location
 */
router.put(
  '/:id',
  protect,
  validateObjectId,
  validateFolderUpdate,
  handleValidationErrors,
  updateFolder
);

/**
 * @desc    Move folder to different parent
 * @route   PUT /api/folders/:id/move
 * @access  Private
 * @body    {
 *            "targetParentId": "new_parent_id" // null to move to root level
 *          }
 * 
 * Validation:
 * - Cannot move folder to itself
 * - Cannot move folder to one of its descendants (circular reference)
 * - Target parent must be able to contain subfolders
 * - No name conflicts in target location
 * - Must respect 3-level hierarchy limit
 */
router.put(
  '/:id/move',
  protect,
  validateObjectId,
  validateFolderMove,
  handleValidationErrors,
  moveFolder
);

/**
 * @desc    Delete folder (soft delete)
 * @route   DELETE /api/folders/:id
 * @access  Private
 * 
 * Deletion Rules:
 * - Cannot delete folder if it contains subfolders
 * - Cannot delete protected folders that contain materials
 * - Soft delete: sets isActive=false
 * - Updates parent subfolder count
 * 
 * To delete folder with materials, first move/delete all materials
 * To delete folder with subfolders, first move/delete all subfolders
 */
router.delete(
  '/:id',
  protect,
  validateObjectId,
  handleValidationErrors,
  deleteFolder
);

module.exports = router;