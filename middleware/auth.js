const jwt = require('jsonwebtoken');
const User = require('../models/User');

// Protect routes - verify JWT token
exports.protect = async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith('Bearer')
  ) {
    // Set token from Bearer token in header
    token = req.headers.authorization.split(' ')[1];
  }

  // Make sure token exists
  if (!token) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this resource'
    });
  }

  try {
    // Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Find user by id from token
    const user = await User.findById(decoded.id);

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No user found with this token'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'User account has been deactivated'
      });
    }

    req.user = user;
    next();
  } catch (error) {
    return res.status(401).json({
      success: false,
      message: 'Not authorized to access this resource'
    });
  }
};

// Grant access to specific roles
exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        success: false,
        message: `User role '${req.user.role}' is not authorized to access this resource`
      });
    }
    next();
  };
};

// Super admin only middleware
exports.superAdminOnly = (req, res, next) => {
  if (req.user.role !== 'super_admin') {
    return res.status(403).json({
      success: false,
      message: 'Only super administrators can access this resource'
    });
  }
  next();
};

// Admin or Super admin middleware
exports.adminOrSuperAdmin = (req, res, next) => {
  if (!['admin', 'super_admin', 'super_manager'].includes(req.user.role)) {
    return res.status(403).json({
      success: false,
      message: 'Administrator or Super Manager privileges required to access this resource'
    });
  }
  next();
};

// Filter data by ownership (Multi-tenant middleware)
exports.filterByOwnership = async (req, res, next) => {
  try {
    if (req.user.role === 'super_admin') {
      // Super admin can see everything
      req.dataFilter = {};
      req.canAccessAll = true;
    } else if (req.user.role === 'business_owner') {
      // Business owner can only see their own estates
      req.dataFilter = {
        $or: [
          { owner: req.user.id },
          { createdBy: req.user.id }
        ]
      };
      req.canAccessAll = false;
      req.ownedEstates = req.user.assignedEstates || [];
    } else if (['admin', 'super_manager'].includes(req.user.role)) {
      // Admin/Super Manager can only see estates they manage or are assigned to
      req.dataFilter = {
        managers: req.user.id
      };
      req.canAccessAll = false;
    } else if (req.user.role === 'super_vendor') {
      // Super vendor might have global or specific management needs (placeholder logic)
      req.dataFilter = {};
      req.canAccessAll = true;
    } else {
      // Other roles have no access by default
      req.dataFilter = { _id: null }; // Will match nothing
      req.canAccessAll = false;
    }

    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error applying data filter'
    });
  }
};

// Check if user has access to specific estate
exports.checkEstateAccess = async (req, res, next) => {
  try {
    const estateId = req.params.id;

    if (req.user.role === 'super_admin') {
      // Super admin has access to all
      return next();
    }

    const Estate = require('../models/Estate');
    const estate = await Estate.findById(estateId);

    if (!estate) {
      return res.status(404).json({
        success: false,
        message: 'Estate not found'
      });
    }

    // Check ownership/management access
    const hasAccess =
      req.user.role === 'super_admin' ||
      req.user.role === 'super_manager' ||
      req.user.role === 'super_vendor' ||
      (req.user.role === 'business_owner' && estate.owner && estate.owner.toString() === req.user.id) ||
      (req.user.role === 'admin' && estate.managers && estate.managers.some(m => m.toString() === req.user.id)) ||
      (req.user.role === 'manager' && estate.managers && estate.managers.some(m => m.toString() === req.user.id));

    if (!hasAccess) {
      return res.status(403).json({
        success: false,
        message: 'You do not have access to this estate'
      });
    }

    req.estate = estate;
    next();
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error checking estate access'
    });
  }
};