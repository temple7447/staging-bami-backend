const crypto = require('crypto');
const User = require('../models/User');
const {
  sendEmail,
  sendWelcomeEmail,
  sendPasswordResetEmail,
  sendVerificationEmail,
  sendBusinessOwnerWelcomeEmail
} = require('../utils/emailService');
const { sendPasswordResetOtpEmail } = require('../utils/emailService');

// Generate JWT Token
const sendTokenResponse = (user, statusCode, res) => {
  // Create token
  const token = user.getSignedJwtToken();

  const options = {
    expires: new Date(
      Date.now() + (process.env.JWT_COOKIE_EXPIRE || 30) * 24 * 60 * 60 * 1000
    ),
    httpOnly: true
  };

  if (process.env.NODE_ENV === 'production') {
    options.secure = true;
  }

  res
    .status(statusCode)
    .cookie('token', token, options)
    .json({
      success: true,
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        emailVerified: user.emailVerified,
        lastLogin: user.lastLogin,
        createdAt: user.createdAt
      }
    });
};

// @desc    Register Super Admin (Initial Setup)
// @route   POST /api/auth/register-super-admin
// @access  Public (but should be protected in production)
exports.registerSuperAdmin = async (req, res, next) => {
  try {
    // Check if super admin already exists
    const existingSuperAdmin = await User.findOne({ role: 'super_admin' });

    if (existingSuperAdmin) {
      return res.status(400).json({
        success: false,
        message: 'Super admin already exists'
      });
    }

    const { name, email, password } = req.body;

    // Create super admin
    const superAdmin = await User.create({
      name: name || process.env.SUPER_ADMIN_NAME,
      email: email || process.env.SUPER_ADMIN_EMAIL,
      password: password || process.env.SUPER_ADMIN_PASSWORD,
      role: 'super_admin',
      emailVerified: true // Auto-verify super admin
    });

    // Send welcome email
    try {
      await sendWelcomeEmail(superAdmin);
    } catch (error) {
      console.log('Failed to send welcome email:', error.message);
    }

    sendTokenResponse(superAdmin, 201, res);
  } catch (error) {
    console.error('Register super admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating super admin',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Login user
// @route   POST /api/auth/login
// @access  Public
exports.login = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Validate email & password
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Please provide an email and password'
      });
    }

    // Check for user
    const user = await User.findOne({ email }).select('+password');

    if (!user) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      return res.status(401).json({
        success: false,
        message: 'Account has been deactivated'
      });
    }

    // Check if password matches
    const isMatch = await user.matchPassword(password);

    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid credentials'
      });
    }

    // Update last login
    await user.updateLastLogin();

    sendTokenResponse(user, 200, res);
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error during login'
    });
  }
};

// @desc    Get current logged in user
// @route   GET /api/auth/me
// @access  Private
exports.getMe = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id);

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Update user details
// @route   PUT /api/auth/updatedetails
// @access  Private
exports.updateDetails = async (req, res, next) => {
  try {
    const fieldsToUpdate = {
      name: req.body.name,
      email: req.body.email
    };

    const user = await User.findByIdAndUpdate(req.user.id, fieldsToUpdate, {
      new: true,
      runValidators: true
    });

    res.status(200).json({
      success: true,
      data: user
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Update password
// @route   PUT /api/auth/updatepassword
// @access  Private
exports.updatePassword = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('+password');

    // Check current password
    if (!(await user.matchPassword(req.body.currentPassword))) {
      return res.status(401).json({
        success: false,
        message: 'Password is incorrect'
      });
    }

    user.password = req.body.newPassword;
    await user.save();

    sendTokenResponse(user, 200, res);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Forgot password (link flow)
// @route   POST /api/auth/forgotpassword
// @access  Public
exports.forgotPassword = async (req, res, next) => {
  try {
    const user = await User.findOne({ email: req.body.email });

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'There is no user with that email'
      });
    }

    // Get reset token
    const resetToken = user.getResetPasswordToken();

    await user.save({ validateBeforeSave: false });

    try {
      await sendPasswordResetEmail(user, resetToken);

      res.status(200).json({
        success: true,
        message: 'Email sent successfully'
      });
    } catch (error) {
      console.log(error);
      user.passwordResetToken = undefined;
      user.passwordResetExpire = undefined;

      await user.save({ validateBeforeSave: false });

      return res.status(500).json({
        success: false,
        message: 'Email could not be sent'
      });
    }
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Reset password (link flow)
// @route   PUT /api/auth/resetpassword/:resettoken
// @access  Public
exports.resetPassword = async (req, res, next) => {
  try {
    // Get hashed token
    const resetPasswordToken = crypto
      .createHash('sha256')
      .update(req.params.resettoken)
      .digest('hex');

    const user = await User.findOne({
      passwordResetToken: resetPasswordToken,
      passwordResetExpire: { $gt: Date.now() }
    });

    if (!user) {
      return res.status(400).json({
        success: false,
        message: 'Invalid token'
      });
    }

    // Set new password
    user.password = req.body.password;
    user.passwordResetToken = undefined;
    user.passwordResetExpire = undefined;
    await user.save();

    sendTokenResponse(user, 200, res);
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Create admin user (Super Admin only)
// @route   POST /api/auth/create-admin
// @access  Private (Super Admin only)
exports.createAdmin = async (req, res, next) => {
  try {
    const { name, email, password, sendCredentials = true } = req.body;

    // Generate random password if not provided
    const adminPassword = password || crypto.randomBytes(8).toString('hex');

    // Log admin password in development
    if (process.env.NODE_ENV === 'development') {
      console.log('-----------------------------------------');
      console.log(`[DEV] Admin credentials for ${email}:`);
      console.log(`Password: ${adminPassword}`);
      console.log('-----------------------------------------');
    }

    const admin = await User.create({
      name,
      email,
      password: adminPassword,
      role: 'admin',
      createdBy: req.user.id,
      emailVerified: false
    });

    // Send welcome email with credentials if requested
    if (sendCredentials) {
      try {
        await sendWelcomeEmail(admin, password ? null : adminPassword);
      } catch (error) {
        console.log('Failed to send welcome email:', error.message);
      }
    }

    res.status(201).json({
      success: true,
      message: 'Admin created successfully',
      data: {
        id: admin._id,
        name: admin.name,
        email: admin.email,
        role: admin.role,
        isActive: admin.isActive,
        createdAt: admin.createdAt
      }
    });
  } catch (error) {
    console.error('Create admin error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating admin',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get all admins
// @route   GET /api/auth/admins
// @access  Private (Super Admin only)
exports.getAdmins = async (req, res, next) => {
  try {
    const admins = await User.find({ role: 'admin' })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: admins.length,
      data: admins
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Get all business owners
// @route   GET /api/auth/business-owners
// @access  Private (Super Admin only)
exports.getBusinessOwners = async (req, res) => {
  try {
    const businessOwners = await User.find({ role: 'business_owner' })
      .populate('createdBy', 'name email')
      .populate('assignedEstates', 'name totalUnits')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: businessOwners.length,
      data: businessOwners
    });
  } catch (error) {
    console.error('Get business owners error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Update business owner details
// @route   PUT /api/auth/business-owner/:id
// @access  Private (Super Admin only)
exports.updateBusinessOwner = async (req, res) => {
  try {
    const { name, email, phone, estateIds } = req.body;

    const businessOwner = await User.findById(req.params.id);

    if (!businessOwner || businessOwner.role !== 'business_owner') {
      return res.status(404).json({
        success: false,
        message: 'Business owner not found'
      });
    }

    // Update basic fields
    if (name) businessOwner.name = name;
    if (email) businessOwner.email = email.toLowerCase();
    if (phone !== undefined) businessOwner.phone = phone;

    // Update estates if provided
    if (estateIds) {
      const Estate = require('../models/Estate');

      // Validate estates exist
      const estates = await Estate.find({
        _id: { $in: estateIds },
        isActive: true
      });

      if (estates.length !== estateIds.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more estates not found or inactive'
        });
      }

      // Remove ownership from old estates
      await Estate.updateMany(
        { owner: businessOwner._id },
        { $unset: { owner: 1 } }
      );

      // Set ownership for new estates
      await Estate.updateMany(
        { _id: { $in: estateIds } },
        { owner: businessOwner._id, updatedBy: req.user.id }
      );

      businessOwner.assignedEstates = estateIds;
    }

    await businessOwner.save();

    // Populate estates for response
    await businessOwner.populate('assignedEstates', 'name totalUnits');

    res.status(200).json({
      success: true,
      message: 'Business owner updated successfully',
      data: businessOwner
    });
  } catch (error) {
    console.error('Update business owner error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update business owner status
// @route   PUT /api/auth/business-owner/:id/status
// @access  Private (Super Admin only)
exports.updateBusinessOwnerStatus = async (req, res) => {
  try {
    const { isActive } = req.body;

    const businessOwner = await User.findById(req.params.id);

    if (!businessOwner || businessOwner.role !== 'business_owner') {
      return res.status(404).json({
        success: false,
        message: 'Business owner not found'
      });
    }

    businessOwner.isActive = isActive;
    await businessOwner.save();

    res.status(200).json({
      success: true,
      message: `Business owner ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: businessOwner
    });
  } catch (error) {
    console.error('Update business owner status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Delete business owner
// @route   DELETE /api/auth/business-owner/:id
// @access  Private (Super Admin only)
exports.deleteBusinessOwner = async (req, res) => {
  try {
    const businessOwner = await User.findById(req.params.id);

    if (!businessOwner || businessOwner.role !== 'business_owner') {
      return res.status(404).json({
        success: false,
        message: 'Business owner not found'
      });
    }

    // Remove ownership from estates
    const Estate = require('../models/Estate');
    await Estate.updateMany(
      { owner: businessOwner._id },
      { $unset: { owner: 1 }, updatedBy: req.user.id }
    );

    // Delete the user
    await businessOwner.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Business owner deleted successfully'
    });
  } catch (error) {
    console.error('Delete business owner error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Update admin status
// @route   PUT /api/auth/admin/:id/status
// @access  Private (Super Admin only)
exports.updateAdminStatus = async (req, res, next) => {
  try {
    const { isActive } = req.body;

    const admin = await User.findById(req.params.id);

    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    admin.isActive = isActive;
    await admin.save();

    res.status(200).json({
      success: true,
      message: `Admin ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: admin
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Delete admin
// @route   DELETE /api/auth/admin/:id
// @access  Private (Super Admin only)
// @desc    Forgot password - send 6-digit OTP to email
// @route   POST /api/auth/forgotpassword-otp
// @access  Public
exports.forgotPasswordOtp = async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) {
      return res.status(400).json({ success: false, message: 'Email is required' });
    }

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      console.log(`[AUTH DEBUG] OTP request failed: User not found with email ${email}`);
      // To avoid account enumeration, return success but do nothing
      return res.status(200).json({ success: true, message: 'If the email exists, an OTP has been sent' });
    }

    // Generate 6-digit code
    const code = (Math.floor(100000 + Math.random() * 900000)).toString();

    // Log OTP in development
    if (process.env.NODE_ENV === 'development') {
      console.log('-----------------------------------------');
      console.log(`[DEV] OTP Code for ${email}: ${code}`);
      console.log('-----------------------------------------');
    }

    const hash = require('crypto').createHash('sha256').update(code).digest('hex');

    user.passwordResetOtpHash = hash;
    user.passwordResetOtpExpire = new Date(Date.now() + 10 * 60 * 1000); // 10 min
    await user.save({ validateBeforeSave: false });

    await sendPasswordResetOtpEmail(user, code);

    return res.status(200).json({ success: true, message: 'OTP sent to email' });
  } catch (error) {
    console.error('forgotPasswordOtp error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Reset password using email + 6-digit OTP
// @route   POST /api/auth/resetpassword-otp
// @access  Public
exports.resetPasswordWithOtp = async (req, res) => {
  try {
    const { email, code, password } = req.body || {};
    if (!email || !code || !password) {
      return res.status(400).json({ success: false, message: 'Email, code and password are required' });
    }

    const user = await User.findOne({ email }).select('+password');
    if (!user || !user.passwordResetOtpHash || !user.passwordResetOtpExpire) {
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }

    if (user.passwordResetOtpExpire.getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'Code expired' });
    }

    const hash = require('crypto').createHash('sha256').update(code).digest('hex');
    if (hash !== user.passwordResetOtpHash) {
      return res.status(400).json({ success: false, message: 'Invalid code' });
    }

    user.password = password;
    user.passwordResetOtpHash = undefined;
    user.passwordResetOtpExpire = undefined;
    await user.save();

    return res.status(200).json({ success: true, message: 'Password reset successful' });
  } catch (error) {
    console.error('resetPasswordWithOtp error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc    Verify password reset OTP (no password change)
// @route   POST /api/auth/verify-otp
// @access  Public
exports.verifyPasswordOtp = async (req, res) => {
  try {
    const { email, code } = req.body || {};
    if (!email || !code) {
      return res.status(400).json({ success: false, message: 'Email and code are required' });
    }

    const user = await User.findOne({ email });
    if (!user || !user.passwordResetOtpHash || !user.passwordResetOtpExpire) {
      return res.status(400).json({ success: false, message: 'Invalid or expired code' });
    }

    if (user.passwordResetOtpExpire.getTime() < Date.now()) {
      return res.status(400).json({ success: false, message: 'Code expired' });
    }

    const hash = require('crypto').createHash('sha256').update(code).digest('hex');
    if (hash !== user.passwordResetOtpHash) {
      return res.status(400).json({ success: false, message: 'Invalid code' });
    }

    return res.status(200).json({ success: true, message: 'OTP verified' });
  } catch (error) {
    console.error('verifyPasswordOtp error:', error);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
};

exports.deleteAdmin = async (req, res, next) => {
  try {
    const admin = await User.findById(req.params.id);

    if (!admin || admin.role !== 'admin') {
      return res.status(404).json({
        success: false,
        message: 'Admin not found'
      });
    }

    await admin.remove();

    res.status(200).json({
      success: true,
      message: 'Admin deleted successfully'
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Update super admin email
// @route   PUT /api/auth/update-superadmin-email
// @access  Private (Super Admin only)
exports.updateSuperAdminEmail = async (req, res, next) => {
  try {
    const { email, password } = req.body;

    // Verify user is super admin
    if (req.user.role !== 'super_admin') {
      return res.status(403).json({
        success: false,
        message: 'Only super administrators can use this endpoint'
      });
    }

    // Validate email and password are provided
    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: 'Email and password are required'
      });
    }

    // Get user with password for verification
    const user = await User.findById(req.user.id).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Verify current password
    const isMatch = await user.matchPassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: 'Invalid password'
      });
    }

    // Check if new email is already in use by another user
    const existingUser = await User.findOne({
      email: email.toLowerCase(),
      _id: { $ne: user._id }
    });

    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'Email is already in use'
      });
    }

    // Update email
    user.email = email.toLowerCase();
    await user.save();

    res.status(200).json({
      success: true,
      message: 'Email updated successfully',
      data: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error('Update super admin email error:', error);
    res.status(500).json({
      success: false,
      message: 'Error updating email',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// Helper function to generate secure password
const generateSecurePassword = (length = 12) => {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789!@#$%^&*';
  let password = '';
  const randomBytes = require('crypto').randomBytes(length);

  for (let i = 0; i < length; i++) {
    password += charset[randomBytes[i] % charset.length];
  }

  return password;
};

// @desc    Onboard Business Owner (Super Admin only)
// @route   POST /api/auth/onboard-business-owner
// @access  Private (Super Admin only)
exports.onboardBusinessOwner = async (req, res) => {
  try {
    const { name, email, phone, estateIds = [], sendCredentials = true } = req.body;

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required'
      });
    }

    // Check ifuser already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Validate estates if provided
    const Estate = require('../models/Estate');
    let assignedEstates = [];

    if (estateIds.length > 0) {
      assignedEstates = await Estate.find({
        _id: { $in: estateIds },
        isActive: true
      });

      if (assignedEstates.length !== estateIds.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more estates not found or inactive'
        });
      }
    }

    // Generate secure password
    const temporaryPassword = generateSecurePassword(12);

    // Log temporary password in development
    if (process.env.NODE_ENV === 'development') {
      console.log('-----------------------------------------');
      console.log(`[DEV] Business Owner credentials for ${email}:`);
      console.log(`Password: ${temporaryPassword}`);
      console.log('-----------------------------------------');
    }

    // Create business owner user
    const businessOwner = await User.create({
      name,
      email: email.toLowerCase(),
      phone,
      password: temporaryPassword,
      role: 'business_owner',
      assignedEstates: estateIds,
      createdBy: req.user.id,
      emailVerified: false
    });

    // Update estates to set owner
    if (assignedEstates.length > 0) {
      await Estate.updateMany(
        { _id: { $in: estateIds } },
        {
          owner: businessOwner._id,
          updatedBy: req.user.id
        }
      );
    }

    // Send welcome email with credentials
    if (sendCredentials) {
      try {
        await sendBusinessOwnerWelcomeEmail(businessOwner, temporaryPassword, assignedEstates);
      } catch (error) {
        console.log('Failed to send welcome email:', error.message);
        // Don't fail the request if email fails
      }
    }

    // Return success response
    res.status(201).json({
      success: true,
      message: sendCredentials
        ? `Business owner onboarded successfully. Credentials sent to ${email}`
        : 'Business owner onboarded successfully',
      data: {
        id: businessOwner._id,
        name: businessOwner.name,
        email: businessOwner.email,
        phone: businessOwner.phone,
        role: businessOwner.role,
        assignedEstates: assignedEstates.map(e => ({
          _id: e._id,
          name: e.name,
          totalUnits: e.totalUnits
        })),
        isActive: businessOwner.isActive,
        createdAt: businessOwner.createdAt
      }
    });
  } catch (error) {
    console.error('Onboard business owner error:', error);
    res.status(500).json({
      success: false,
      message: 'Error onboarding business owner',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Onboard Vendor (Admin only)
// @route   POST /api/auth/onboard-vendor
// @access  Private (Admin/Super Admin)
exports.onboardVendor = async (req, res) => {
  try {
    const {
      name,
      email,
      phone,
      businessTypeId,
      businessName,
      specialization,
      sendCredentials = true
    } = req.body;

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Validate business type if provided
    let businessType = null;
    if (businessTypeId) {
      const BusinessType = require('../models/BusinessType');
      businessType = await BusinessType.findOne({
        _id: businessTypeId,
        isActive: true
      });

      if (!businessType) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or inactive business type'
        });
      }
    }

    // Generate secure password
    const temporaryPassword = generateSecurePassword(12);

    // Log temporary password in development
    if (process.env.NODE_ENV === 'development') {
      console.log('-----------------------------------------');
      console.log(`[DEV] Vendor credentials for ${email}:`);
      console.log(`Password: ${temporaryPassword}`);
      console.log('-----------------------------------------');
    }

    // Create vendor user
    const vendor = await User.create({
      name,
      email: email.toLowerCase(),
      phone,
      password: temporaryPassword,
      role: 'vendor',
      createdBy: req.user.id,
      emailVerified: false
    });

    // Send welcome email with credentials
    if (sendCredentials) {
      try {
        const { sendVendorWelcomeEmail } = require('../utils/emailService');
        await sendVendorWelcomeEmail(vendor, temporaryPassword, {
          businessType: businessType?.name,
          businessName,
          specialization
        });
      } catch (error) {
        console.log('Failed to send welcome email:', error.message);
        // Don't fail the request if email fails
      }
    }

    // Return success response
    res.status(201).json({
      success: true,
      message: sendCredentials
        ? `Vendor onboarded successfully. Credentials sent to ${email}`
        : 'Vendor onboarded successfully',
      data: {
        id: vendor._id,
        name: vendor.name,
        email: vendor.email,
        phone: vendor.phone,
        role: vendor.role,
        businessType: businessType?.name,
        businessName,
        specialization,
        isActive: vendor.isActive,
        createdAt: vendor.createdAt
      }
    });
  } catch (error) {
    console.error('Onboard vendor error:', error);
    res.status(500).json({
      success: false,
      message: 'Error onboarding vendor',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update vendor details
// @route   PUT /api/auth/vendor/:id
// @access  Private (Admin/Super Admin)
exports.updateVendor = async (req, res) => {
  try {
    const { name, email, phone, businessTypeId, businessName, specialization } = req.body;

    const vendor = await User.findById(req.params.id);

    if (!vendor || vendor.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Validate business type if provided
    let businessType = null;
    if (businessTypeId) {
      const BusinessType = require('../models/BusinessType');
      businessType = await BusinessType.findOne({
        _id: businessTypeId,
        isActive: true
      });

      if (!businessType) {
        return res.status(400).json({
          success: false,
          message: 'Invalid or inactive business type'
        });
      }
    }

    // Update basic fields
    if (name) vendor.name = name;
    if (email) vendor.email = email.toLowerCase();
    if (phone !== undefined) vendor.phone = phone;

    await vendor.save();

    res.status(200).json({
      success: true,
      message: 'Vendor updated successfully',
      data: {
        id: vendor._id,
        name: vendor.name,
        email: vendor.email,
        phone: vendor.phone,
        role: vendor.role,
        businessType: businessType?.name,
        businessName,
        specialization,
        isActive: vendor.isActive
      }
    });
  } catch (error) {
    console.error('Update vendor error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get all vendors
// @route   GET /api/auth/vendors
// @access  Private (Admin/Super Admin)
exports.getVendors = async (req, res) => {
  try {
    const vendors = await User.find({ role: 'vendor' })
      .populate('createdBy', 'name email')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: vendors.length,
      data: vendors
    });
  } catch (error) {
    console.error('Get vendors error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Update vendor status
// @route   PUT /api/auth/vendor/:id/status
// @access  Private (Admin/Super Admin)
exports.updateVendorStatus = async (req, res) => {
  try {
    const { isActive } = req.body;

    const vendor = await User.findById(req.params.id);

    if (!vendor || vendor.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    vendor.isActive = isActive;
    await vendor.save();

    res.status(200).json({
      success: true,
      message: `Vendor ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: vendor
    });
  } catch (error) {
    console.error('Update vendor status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Delete vendor
// @route   DELETE /api/auth/vendor/:id
// @access  Private (Admin/Super Admin)
exports.deleteVendor = async (req, res) => {
  try {
    const vendor = await User.findById(req.params.id);

    if (!vendor || vendor.role !== 'vendor') {
      return res.status(404).json({
        success: false,
        message: 'Vendor not found'
      });
    }

    // Delete the user
    await vendor.deleteOne();

    res.status(200).json({
      success: true,
      message: 'Vendor deleted successfully'
    });
  } catch (error) {
    console.error('Delete vendor error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Onboard Manager (Admin/Super Admin)
// @route   POST /api/auth/onboard-manager
// @access  Private (Admin/Super Admin)
exports.onboardManager = async (req, res) => {
  try {
    const { name, email, phone, estateIds = [], sendCredentials = true } = req.body;

    // Validate required fields
    if (!name || !email) {
      return res.status(400).json({
        success: false,
        message: 'Name and email are required'
      });
    }

    // Check if user already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: 'User with this email already exists'
      });
    }

    // Validate estates if provided
    const Estate = require('../models/Estate');
    let assignedEstates = [];

    if (estateIds.length > 0) {
      assignedEstates = await Estate.find({
        _id: { $in: estateIds },
        isActive: true
      });

      if (assignedEstates.length !== estateIds.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more estates not found or inactive'
        });
      }
    }

    // Generate secure password
    const temporaryPassword = generateSecurePassword(12);

    // Log temporary password in development
    if (process.env.NODE_ENV === 'development') {
      console.log('-----------------------------------------');
      console.log(`[DEV] Manager credentials for ${email}:`);
      console.log(`Password: ${temporaryPassword}`);
      console.log('-----------------------------------------');
    }

    // Create manager user
    const manager = await User.create({
      name,
      email: email.toLowerCase(),
      phone,
      password: temporaryPassword,
      role: 'manager',
      assignedEstates: estateIds,
      createdBy: req.user.id,
      emailVerified: false
    });

    // Send welcome email with credentials
    if (sendCredentials) {
      try {
        const { sendManagerWelcomeEmail } = require('../utils/emailService');
        await sendManagerWelcomeEmail(manager, temporaryPassword, assignedEstates);
      } catch (error) {
        console.log('Failed to send welcome email:', error.message);
        // Don't fail the request if email fails
      }
    }

    // Return success response
    res.status(201).json({
      success: true,
      message: sendCredentials
        ? `Manager onboarded successfully. Credentials sent to ${email}`
        : 'Manager onboarded successfully',
      data: {
        id: manager._id,
        name: manager.name,
        email: manager.email,
        phone: manager.phone,
        role: manager.role,
        assignedEstates: assignedEstates.map(e => ({
          _id: e._id,
          name: e.name,
          totalUnits: e.totalUnits
        })),
        isActive: manager.isActive,
        createdAt: manager.createdAt
      }
    });
  } catch (error) {
    console.error('Onboard manager error:', error);
    res.status(500).json({
      success: false,
      message: 'Error onboarding manager',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Get all managers
// @route   GET /api/auth/managers
// @access  Private (Admin/Super Admin)
exports.getManagers = async (req, res) => {
  try {
    const managers = await User.find({ role: 'manager' })
      .populate('createdBy', 'name email')
      .populate('assignedEstates', 'name totalUnits')
      .sort({ createdAt: -1 });

    res.status(200).json({
      success: true,
      count: managers.length,
      data: managers
    });
  } catch (error) {
    console.error('Get managers error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Update manager details
// @route   PUT /api/auth/manager/:id
// @access  Private (Admin/Super Admin)
exports.updateManager = async (req, res) => {
  try {
    const { name, email, phone, estateIds } = req.body;

    const manager = await User.findById(req.params.id);

    if (!manager || manager.role !== 'manager') {
      return res.status(404).json({
        success: false,
        message: 'Manager not found'
      });
    }

    // Update basic fields
    if (name) manager.name = name;
    if (email) manager.email = email.toLowerCase();
    if (phone !== undefined) manager.phone = phone;

    // Update estates if provided
    if (estateIds) {
      const Estate = require('../models/Estate');

      // Validate estates exist
      const estates = await Estate.find({
        _id: { $in: estateIds },
        isActive: true
      });

      if (estates.length !== estateIds.length) {
        return res.status(400).json({
          success: false,
          message: 'One or more estates not found or inactive'
        });
      }

      manager.assignedEstates = estateIds;
    }

    await manager.save();

    // Populate estates for response
    await manager.populate('assignedEstates', 'name totalUnits');

    res.status(200).json({
      success: true,
      message: 'Manager updated successfully',
      data: manager
    });
  } catch (error) {
    console.error('Update manager error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error',
      error: process.env.NODE_ENV === 'development' ? error.message : undefined
    });
  }
};

// @desc    Update manager status
// @route   PUT /api/auth/manager/:id/status
// @access  Private (Admin/Super Admin)
exports.updateManagerStatus = async (req, res) => {
  try {
    const { isActive } = req.body;

    const manager = await User.findById(req.params.id);

    if (!manager || manager.role !== 'manager') {
      return res.status(404).json({
        success: false,
        message: 'Manager not found'
      });
    }

    manager.isActive = isActive;
    await manager.save();

    res.status(200).json({
      success: true,
      message: `Manager ${isActive ? 'activated' : 'deactivated'} successfully`,
      data: manager
    });
  } catch (error) {
    console.error('Update manager status error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Delete manager
// @route   DELETE /api/auth/manager/:id
// @access  Private (Admin/Super Admin)
exports.deleteManager = async (req, res) => {
  try {
    const manager = await User.findById(req.params.id);

    if (!manager || manager.role !== 'manager') {
      return res.status(404).json({
        success: false,
        message: 'Manager not found'
      });
    }

    // Soft delete by setting isActive to false
    manager.isActive = false;
    await manager.save();

    res.status(200).json({
      success: true,
      message: 'Manager deleted successfully'
    });
  } catch (error) {
    console.error('Delete manager error:', error);
    res.status(500).json({
      success: false,
      message: 'Server error'
    });
  }
};

// @desc    Logout user / clear cookie
// @route   GET /api/auth/logout
// @access  Private
exports.logout = async (req, res, next) => {
  res.cookie('token', 'none', {
    expires: new Date(Date.now() + 10 * 1000),
    httpOnly: true
  });

  res.status(200).json({
    success: true,
    message: 'User logged out successfully'
  });
};