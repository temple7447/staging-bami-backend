const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const Transaction = require('../models/Transaction');
const User = require('../models/User');
const crypto = require('crypto');
const { sendTenantWelcomeEmail } = require('../utils/emailService');
const { validationResult } = require('express-validator');

// Generate a random alphanumeric password of given length (at least one letter and one digit)
function generateTempPassword(len = 6) {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
  const digits = '0123456789';
  const all = letters + digits;
  const pick = set => set[Math.floor(Math.random() * set.length)];
  let pwd = pick(letters) + pick(digits);
  for (let i = 2; i < len; i++) pwd += pick(all);
  // Shuffle to avoid fixed first 2 positions
  return pwd.split('').sort(() => Math.random() - 0.5).join('');
}

// Create tenant under an estate
const createTenant = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const { estateId } = req.params;
    const estate = await Estate.findById(estateId);
    if (!estate || !estate.isActive) {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }

    const {
      unitLabel,
      tenantName,
      firstName,
      surname,
      otherNames,
      tenantEmail,
      email,
      tenantPhone,
      whatsapp,
      rentAmount,
      tenantType,
      electricMeterNumber,
      nextDueDate,
      status
    } = req.body;

    // Build full name and contact fields from UI-friendly inputs
    const fullName = (tenantName && tenantName.trim()) ||
      [firstName, otherNames, surname].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

    const phone = tenantPhone || whatsapp || '';
    const emailAddr = tenantEmail || email || '';

    // Parse nextDueDate: accept ISO, timestamp, or dd/mm/yyyy
    let parsedNextDueDate = undefined;
    if (nextDueDate) {
      if (typeof nextDueDate === 'string' && /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.test(nextDueDate)) {
        const [, d, m, y] = nextDueDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        const year = parseInt(y.length === 2 ? '20' + y : y, 10);
        parsedNextDueDate = new Date(year, parseInt(m, 10) - 1, parseInt(d, 10));
      } else {
        const dt = new Date(nextDueDate);
        if (!isNaN(dt.getTime())) parsedNextDueDate = dt;
      }
    }

    // Optionally create or link a user account for tenant
    let userId = undefined;
    let generatedPassword = null;
    if (emailAddr) {
      let existingUser = await User.findOne({ email: emailAddr });
      if (existingUser) {
        userId = existingUser._id;
      } else {
        generatedPassword = generateTempPassword(6);
        const newUser = await User.create({
          name: fullName || 'Tenant',
          email: emailAddr,
          password: generatedPassword,
          role: 'user',
          createdBy: req.user?.id,
          emailVerified: true
        });
        userId = newUser._id;
      }
    }

    const tenant = await Tenant.create({
      estate: estateId,
      unitLabel,
      tenantName: fullName,
      tenantEmail: emailAddr || undefined,
      tenantPhone: phone || undefined,
      rentAmount,
      tenantType,
      electricMeterNumber,
      nextDueDate: parsedNextDueDate,
      status,
      user: userId,
      history: [{ event: 'created', note: 'Tenant record created', meta: { unitLabel, rentAmount }, createdBy: req.user?.id }],
      createdBy: req.user?.id,
    });

    // If we created a brand new user and have an email, send credentials
    if (emailAddr && generatedPassword) {
      try {
        const userDoc = await User.findById(userId);
        await sendTenantWelcomeEmail(userDoc, generatedPassword, tenant.toObject(), { name: estate.name });
      } catch (e) {
        console.log('Failed to send tenant welcome email:', e?.message || e);
      }
    }

    res.status(201).json({ success: true, message: 'Tenant created successfully', data: tenant });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'A tenant already exists for this unit in the estate' });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: err.message });
    }
    console.error('Create tenant error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while creating tenant' });
  }
};

// List tenants (optionally filter by estateId)
const getTenants = async (req, res) => {
  try {
    const { estateId } = req.params;
    const { page = 1, limit = 20, search } = req.query;

    const filter = { isActive: true };
    if (estateId) filter.estate = estateId;
    if (search) filter.$or = [
      { tenantName: new RegExp(search, 'i') },
      { unitLabel: new RegExp(search, 'i') },
      { tenantEmail: new RegExp(search, 'i') },
      { tenantPhone: new RegExp(search, 'i') },
    ];

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [items, total] = await Promise.all([
      Tenant.find(filter).populate('estate', 'name').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Tenant.countDocuments(filter)
    ]);

    res.status(200).json({ success: true, data: items, pagination: {
      currentPage: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)), totalItems: total, itemsPerPage: parseInt(limit)
    }});
  } catch (err) {
    console.error('Get tenants error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while fetching tenants' });
  }
};

// Get a tenant (supports expand=history,transactions)
const getTenant = async (req, res) => {
  try {
    const { expand, page = 1, limit = 10 } = req.query;
    const includeHistory = expand?.includes('history');
    const includeTx = expand?.includes('transactions');

    const tenant = await Tenant.findById(req.params.id).populate('estate', 'name');
    if (!tenant || !tenant.isActive) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    const overview = {
      name: tenant.tenantName,
      unit: tenant.unitLabel,
      email: tenant.tenantEmail,
      phone: tenant.tenantPhone,
      rent: tenant.rentAmount,
      nextDue: tenant.nextDueDate,
      meter: tenant.electricMeterNumber,
      type: tenant.tenantType,
      typeBadge: tenant.tenantType === 'new' ? 'New' : tenant.tenantType === 'existing' ? 'Existing' : tenant.tenantType === 'renewal' ? 'Renewal' : 'Transfer',
      status: tenant.status
    };

    const response = { success: true, data: { tenant, overview } };

    if (includeHistory) {
      response.data.history = tenant.history?.slice(-parseInt(limit)).reverse() || [];
    }

    if (includeTx) {
      const skip = (parseInt(page) - 1) * parseInt(limit);
      const [items, total] = await Promise.all([
        Transaction.find({ tenant: tenant._id, isActive: true })
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(parseInt(limit)),
        Transaction.countDocuments({ tenant: tenant._id, isActive: true })
      ]);
      response.data.transactions = items;
      response.pagination = { currentPage: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)), totalItems: total, itemsPerPage: parseInt(limit) };
    }

    res.status(200).json(response);
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    console.error('Get tenant error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while fetching tenant' });
  }
};

// Update tenant
const updateTenant = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const tenant = await Tenant.findById(req.params.id);
    if (!tenant || !tenant.isActive) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    const {
      unitLabel,
      tenantName,
      firstName,
      surname,
      otherNames,
      tenantEmail,
      email,
      tenantPhone,
      whatsapp,
      rentAmount,
      tenantType,
      electricMeterNumber,
      nextDueDate
    } = req.body;

    if (unitLabel !== undefined) tenant.unitLabel = unitLabel;

    // Update name if provided either as full or parts
    if (tenantName !== undefined || firstName !== undefined || surname !== undefined || otherNames !== undefined) {
      const fullName = (tenantName && tenantName.trim()) ||
        [firstName ?? '', otherNames ?? '', surname ?? ''].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
      if (fullName) tenant.tenantName = fullName;
    }

    if (tenantEmail !== undefined || email !== undefined) tenant.tenantEmail = (tenantEmail || email) || undefined;
    if (tenantPhone !== undefined || whatsapp !== undefined) tenant.tenantPhone = (tenantPhone || whatsapp) || undefined;
    if (rentAmount !== undefined) tenant.rentAmount = parseInt(rentAmount);
    if (tenantType !== undefined) tenant.tenantType = tenantType;
    if (electricMeterNumber !== undefined) tenant.electricMeterNumber = electricMeterNumber;

    if (nextDueDate !== undefined) {
      let parsed;
      if (typeof nextDueDate === 'string' && /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.test(nextDueDate)) {
        const [, d, m, y] = nextDueDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
        const year = parseInt(y.length === 2 ? '20' + y : y, 10);
        parsed = new Date(year, parseInt(m, 10) - 1, parseInt(d, 10));
      } else {
        const dt = new Date(nextDueDate);
        if (!isNaN(dt.getTime())) parsed = dt;
      }
      tenant.nextDueDate = parsed;
    }

    if (req.user?.id) tenant.updatedBy = req.user.id;

    await tenant.save();

    res.status(200).json({ success: true, message: 'Tenant updated successfully', data: tenant });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(400).json({ success: false, message: 'A tenant already exists for this unit in the estate' });
    }
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: err.message });
    }
    console.error('Update tenant error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while updating tenant' });
  }
};

// Add a history entry
const addHistory = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const tenant = await Tenant.findById(req.params.id);
    if (!tenant || !tenant.isActive) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    const { event, note, meta } = req.body;
    tenant.history.push({ event, note, meta, createdBy: req.user?.id });
    await tenant.save();

    res.status(201).json({ success: true, message: 'History added', data: tenant.history[tenant.history.length - 1] });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    console.error('Add history error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while adding history' });
  }
};

// Create a transaction for a tenant
const addTransaction = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const tenant = await Tenant.findById(req.params.id);
    if (!tenant || !tenant.isActive) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    const { amount, type, method, status, reference, periodMonth, periodYear, notes } = req.body;
    const tx = await Transaction.create({
      tenant: tenant._id,
      estate: tenant.estate,
      amount,
      type,
      method,
      status,
      reference,
      periodMonth,
      periodYear,
      notes,
      createdBy: req.user?.id
    });

    // Record in tenant history
    tenant.history.push({ event: 'payment', note: `Payment ${type}`, meta: { amount, reference }, createdBy: req.user?.id });
    await tenant.save();

    res.status(201).json({ success: true, message: 'Transaction recorded', data: tx });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    console.error('Add transaction error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while creating transaction' });
  }
};

// List tenant transactions
const listTransactions = async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query;
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant || !tenant.isActive) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [items, total] = await Promise.all([
      Transaction.find({ tenant: tenant._id, isActive: true }).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Transaction.countDocuments({ tenant: tenant._id, isActive: true })
    ]);
    res.status(200).json({ success: true, data: items, pagination: { currentPage: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)), totalItems: total, itemsPerPage: parseInt(limit) } });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    console.error('List transactions error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while fetching transactions' });
  }
};

// List tenant history
const listHistory = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant || !tenant.isActive) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    const items = (tenant.history || []).slice().reverse();
    res.status(200).json({ success: true, data: items });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    console.error('List history error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while fetching history' });
  }
};

// Delete tenant (soft)
const deleteTenant = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant || !tenant.isActive) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    tenant.isActive = false;
    if (req.user?.id) tenant.updatedBy = req.user.id;
    await tenant.save();

    res.status(200).json({ success: true, message: 'Tenant deleted successfully' });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    console.error('Delete tenant error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while deleting tenant' });
  }
};

// Upload/replace tenant profile image (admin for any tenant, or the tenant themselves)
const { cloudinary, ensureCloudinaryConfigured } = require('../config/cloudinary');

async function uploadTenantAvatar(req, res) {
  try {
    ensureCloudinaryConfigured();

    const tenant = await Tenant.findById(req.params.id);
    if (!tenant || !tenant.isActive) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    // Authorization: admin/super_admin OR owner of tenant record
    const isAdmin = ['admin', 'super_admin'].includes(req.user.role);
    const isOwner = tenant.user?.toString() === req.user.id;
    if (!isAdmin && !isOwner) {
      return res.status(403).json({ success: false, message: 'Not allowed to update this tenant profile image' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No image file uploaded' });
    }

    // Destroy previous image if exists
    if (tenant.profileImagePublicId) {
      try { await cloudinary.uploader.destroy(tenant.profileImagePublicId, { resource_type: 'image' }); } catch (_) {}
    }

    const folder = (process.env.CLOUDINARY_FOLDER || 'uploads') + '/avatars';
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream({ folder, resource_type: 'image' }, (err, resu) => {
        if (err) return reject(err);
        resolve(resu);
      });
      stream.end(req.file.buffer);
    });

    tenant.profileImageUrl = result.secure_url;
    tenant.profileImagePublicId = result.public_id;
    tenant.updatedBy = req.user.id;
    await tenant.save();

    return res.status(200).json({ success: true, message: 'Profile image updated', data: { url: tenant.profileImageUrl, public_id: tenant.profileImagePublicId } });
  } catch (err) {
    console.error('Upload avatar error:', err);
    const status = err.http_code || 500;
    return res.status(status).json({ success: false, message: err.message || 'Failed to upload profile image' });
  }
}

async function uploadMyAvatar(req, res) {
  try {
    // Find tenant record linked to this user
    const tenant = await Tenant.findOne({ user: req.user.id, isActive: true });
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant record not found for this user' });
    }
    req.params.id = tenant._id.toString();
    return uploadTenantAvatar(req, res);
  } catch (err) {
    console.error('Upload my avatar error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

module.exports = {
  createTenant,
  getTenants,
  getTenant,
  updateTenant,
  deleteTenant,
  addHistory,
  listHistory,
  addTransaction,
  listTransactions,
  uploadTenantAvatar,
  uploadMyAvatar,
};
