const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const UserSchema = new mongoose.Schema({
  name: {
    type: String,
    required: [true, 'Please provide a name'],
    maxlength: [50, 'Name cannot be more than 50 characters'],
    trim: true
  },
  email: {
    type: String,
    required: [true, 'Please provide an email'],
    unique: true,
    lowercase: true,
    match: [
      /^\w+([\.-]?\w+)*@\w+([\.-]?\w+)*(\.\w{2,3})+$/,
      'Please provide a valid email'
    ]
  },
  password: {
    type: String,
    required: [true, 'Please provide a password'],
    minlength: [6, 'Password must be at least 6 characters'],
    select: false // Don't include password in queries by default
  },
  role: {
    type: String,
    enum: ['super_admin', 'admin', 'business_owner', 'manager', 'super_manager', 'vendor', 'super_vendor', 'tenant', 'user'],
    default: 'tenant'
  },
  // For business_owner role - estates they own
  assignedEstates: [{
    type: mongoose.Schema.ObjectId,
    ref: 'Estate'
  }],
  // For future extensibility - other business types
  assignedBusinesses: [{
    businessType: {
      type: String,
      enum: ['estate', 'hotel', 'restaurant', 'retail', 'other']
    },
    businessId: mongoose.Schema.ObjectId
  }],
  // Contact information
  phone: {
    type: String,
    trim: true
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  createdBy: {
    type: mongoose.Schema.ObjectId,
    ref: 'User'
  },
  emailVerified: {
    type: Boolean,
    default: false
  },
  emailVerificationToken: String,
  passwordResetToken: String,
  passwordResetExpire: Date,
  // OTP-based password reset (6-digit) storage
  passwordResetOtpHash: String,
  passwordResetOtpExpire: Date,
  // Profile image (Cloudinary)
  profileImageUrl: { type: String },
  profileImagePublicId: { type: String },
  // Vendor specific fields
  businessName: {
    type: String,
    trim: true
  },
  businessTypeId: {
    type: mongoose.Schema.ObjectId,
    ref: 'BusinessType'
  },
  specialization: {
    type: String,
    trim: true
  },
  cacNumber: {
    type: String,
    trim: true
  },
  govId: {
    type: String // URL to uploaded ID
  },
  certification: {
    type: String // URL to uploaded certificate
  },
  businessAddress: {
    type: String,
    trim: true
  },
  portfolio: [{
    type: String // URLs to work images
  }],
  bio: {
    type: String,
    trim: true,
    maxlength: [1000, 'Bio cannot be more than 1000 characters']
  },
  rating: {
    type: Number,
    default: 0,
    min: [0, 'Rating cannot be less than 0'],
    max: [5, 'Rating cannot be more than 5']
  },
  reviewCount: {
    type: Number,
    default: 0
  },
  location: {
    city: String,
    state: String
  },
  operationalHours: {
    start: { type: String, default: '9:00 AM' },
    end: { type: String, default: '6:00 PM' }
  },
  isVerifiedPro: {
    type: Boolean,
    default: false
  },
  services: [{
    name: { type: String, required: true },
    description: String,
    price: { type: Number, required: true },
    rateType: {
      type: String,
      enum: ['fixed', 'hourly'],
      default: 'fixed'
    }
  }],
  bankDetails: {
    accountName: { type: String, trim: true },
    accountNumber: { type: String, trim: true },
    bankName: { type: String, trim: true },
    bankCode: { type: String, trim: true }
  }
}, {
  timestamps: true
});

// Encrypt password using bcrypt
UserSchema.pre('save', async function (next) {
  if (!this.isModified('password')) {
    next();
  }

  // Reduced from 12 to 10 for 4x faster hashing (still very secure)
  const salt = await bcrypt.genSalt(parseInt(process.env.BCRYPT_SALT_ROUNDS) || 10);
  this.password = await bcrypt.hash(this.password, salt);
  next();
});

// Sign JWT and return
UserSchema.methods.getSignedJwtToken = function () {
  return jwt.sign({ id: this._id, role: this.role }, process.env.JWT_SECRET, {
    expiresIn: process.env.JWT_EXPIRE || '30d'
  });
};

// Match user entered password to hashed password in database
UserSchema.methods.matchPassword = async function (enteredPassword) {
  return await bcrypt.compare(enteredPassword, this.password);
};

// Generate and hash password token
UserSchema.methods.getResetPasswordToken = function () {
  // Generate token
  const resetToken = require('crypto').randomBytes(20).toString('hex');

  // Hash token and set to passwordResetToken field
  this.passwordResetToken = require('crypto')
    .createHash('sha256')
    .update(resetToken)
    .digest('hex');

  // Set expire
  this.passwordResetExpire = Date.now() + 10 * 60 * 1000; // 10 minutes

  return resetToken;
};

// Generate email verification token
UserSchema.methods.getEmailVerificationToken = function () {
  const verificationToken = require('crypto').randomBytes(20).toString('hex');

  this.emailVerificationToken = require('crypto')
    .createHash('sha256')
    .update(verificationToken)
    .digest('hex');

  return verificationToken;
};

// Update last login
UserSchema.methods.updateLastLogin = function () {
  this.lastLogin = new Date();
  return this.save({ validateBeforeSave: false });
};

// Auto-create wallet for new users
UserSchema.post('save', async function (user) {
  try {
    const Wallet = mongoose.model('Wallet');
    const existingWallet = await Wallet.findOne({ userId: user._id });
    
    if (!existingWallet) {
      await Wallet.create({
        userId: user._id,
        balance: 0,
        currency: 'NGN',
        totalEarnings: 0,
        totalSpent: 0,
        isActive: true
      });
      console.log(`[User Model] Wallet created for user: ${user.email} (${user.role})`);
      
      // Send wallet created email
      try {
        const { sendWalletCreatedEmail } = require('../utils/walletEmailService');
        await sendWalletCreatedEmail(user);
      } catch (emailError) {
        console.error(`[User Model] Failed to send wallet created email:`, emailError.message);
      }
    }
  } catch (error) {
    console.error(`[User Model] Error creating wallet for user ${user._id}:`, error.message);
  }
});

// Performance indexes for common query patterns
UserSchema.index({ email: 1, isActive: 1 });
UserSchema.index({ role: 1, isActive: 1 });
UserSchema.index({ assignedEstates: 1 });
UserSchema.index({ createdAt: -1 });

module.exports = mongoose.model('User', UserSchema);