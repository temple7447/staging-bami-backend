const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const Unit = require('../models/Unit');
const Transaction = require('../models/Transaction');
const Payment = require('../models/Payment');
const User = require('../models/User');
const crypto = require('crypto');
const { sendTenantWelcomeEmail } = require('../utils/emailService');
const { validationResult } = require('express-validator');
const { logError, logInfo, logWarning } = require('../utils/logger');

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

function parseFlexibleDate(input) {
  if (!input) return undefined;
  if (typeof input === 'string' && /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.test(input)) {
    const [, d, m, y] = input.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
    const year = parseInt(y.length === 2 ? '20' + y : y, 10);
    return new Date(year, parseInt(m, 10) - 1, parseInt(d, 10));
  }
  const dt = new Date(input);
  if (!isNaN(dt.getTime())) return dt;
  return undefined;
}

// Create tenant under an estate
const createTenant = async (req, res) => {
  // Extract these early so they're available in error handling
  const unitId = req.body?.unitId;
  const tenantName = req.body?.tenantName;
  const { estateId } = req.params;

  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const estate = await Estate.findById(estateId);
    if (!estate || !estate.isActive) {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }

    const {
      firstName,
      surname,
      otherNames,
      tenantEmail,
      email,
      tenantPhone,
      whatsapp,
      tenantType,
      entryDate,
      nextDueDate
    } = req.body;

    if (!unitId) {
      return res.status(400).json({ success: false, message: 'Unit ID is required' });
    }

    // Verify unit exists and is vacant
    const unit = await Unit.findOne({ _id: unitId, estate: estateId, isActive: true });
    if (!unit) {
      return res.status(404).json({ success: false, message: 'Unit not found in this estate' });
    }

    if (unit.status === 'occupied') {
      return res.status(409).json({ success: false, message: 'This unit is already occupied' });
    }

    // Build full name and contact fields from UI-friendly inputs
    const fullName = (tenantName && tenantName.trim()) ||
      [firstName, otherNames, surname].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();

    const phone = tenantPhone || whatsapp || '';
    const emailAddr = tenantEmail || email || '';

    // Parse dates: accept ISO, timestamp, or dd/mm/yyyy
    const parsedEntryDate = parseFlexibleDate(entryDate);
    const parsedNextDueDate = parseFlexibleDate(nextDueDate);

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
          createdBy: req.user?._id,
          emailVerified: true
        });
        userId = newUser._id;
      }
    }

    const tenant = await Tenant.create({
      estate: estateId,
      unit: unitId,
      unitLabel: unit.label,
      tenantName: fullName,
      tenantEmail: emailAddr || undefined,
      tenantPhone: phone || undefined,
      rentAmount: unit.monthlyPrice,
      tenantType,
      electricMeterNumber: unit.meterNumber,
      entryDate: parsedEntryDate || new Date(),
      nextDueDate: parsedNextDueDate,
      status: 'occupied',
      user: userId,
      history: [{ event: 'created', note: 'Tenant record created', meta: { unitId, unitLabel: unit.label, rentAmount: unit.monthlyPrice }, createdBy: req.user?._id }],
      createdBy: req.user?._id,
    });

    // Update unit to mark as occupied
    unit.occupiedBy = tenant._id;
    unit.status = 'occupied';
    unit.occupiedSince = parsedEntryDate || new Date();
    unit.updatedBy = req.user?._id;
    await unit.save();

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
    logError('POST /api/tenants', err, { unitId: req.body?.unitId, tenantName: req.body?.tenantName, estateId });
    
    if (err.code === 11000) {
      const message = 'A tenant already exists for this unit in the estate';
      logWarning('Duplicate tenant entry attempted', { unitId, tenantName });
      return res.status(400).json({ success: false, message });
    }
    if (err.name === 'ValidationError') {
      logWarning('Validation error on tenant creation', { message: err.message });
      return res.status(400).json({ success: false, message: err.message });
    }
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
      { tenantEmail: new RegExp(search, 'i') },
      { tenantPhone: new RegExp(search, 'i') },
    ];

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [items, total] = await Promise.all([
      Tenant.find(filter).populate('estate', 'name').populate('unit', 'label').sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Tenant.countDocuments(filter)
    ]);

    res.status(200).json({ success: true, data: items, pagination: {
      currentPage: parseInt(page), totalPages: Math.ceil(total / parseInt(limit)), totalItems: total, itemsPerPage: parseInt(limit)
    }});
  } catch (err) {
    logError('GET /api/tenants', err, { estateId, page, limit });
    res.status(500).json({ success: false, message: 'Server error occurred while fetching tenants' });
  }
};

// Get a tenant (supports expand=history,transactions)
const getTenant = async (req, res) => {
  try {
    const { expand, page = 1, limit = 10 } = req.query;
    const includeHistory = expand?.includes('history');
    const includeTx = expand?.includes('transactions');

    console.log('[getTenant] Fetching tenant:', req.params.id, 'with expand:', expand);
    
    const tenant = await Tenant.findById(req.params.id).populate('estate', 'name').populate('unit', 'label monthlyPrice');
    
    console.log('[getTenant] Query result:', tenant ? 'found' : 'not found');
    
    if (!tenant || !tenant.isActive) {
      console.log('[getTenant] Tenant not found or inactive:', req.params.id);
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    
    console.log('[getTenant] Tenant found:', tenant._id);

    const overview = {
      name: tenant.tenantName,
      unit: tenant.unit ? tenant.unit.label : 'N/A',
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
    logError('GET /api/tenants/:id', err, { tenantId: req.params.id, expand });
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
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
      entryDate,
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

    if (entryDate !== undefined) {
      tenant.entryDate = parseFlexibleDate(entryDate);
    }

    if (nextDueDate !== undefined) {
      tenant.nextDueDate = parseFlexibleDate(nextDueDate);
    }

    if (req.user?.id) tenant.updatedBy = req.user.id;

    await tenant.save();

    res.status(200).json({ success: true, message: 'Tenant updated successfully', data: tenant });
  } catch (err) {
    logError('PUT /api/tenants/:id', err, { tenantId: req.params.id });
    if (err.code === 11000) {
      logWarning('Duplicate tenant entry on update', { tenantId: req.params.id });
      return res.status(400).json({ success: false, message: 'A tenant already exists for this unit in the estate' });
    }
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    if (err.name === 'ValidationError') {
      logWarning('Validation error on tenant update', { message: err.message });
      return res.status(400).json({ success: false, message: err.message });
    }
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

// List billing items (what this tenant should pay for)
const listBillingItems = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id).populate('unit', 'label monthlyPrice serviceChargeMonthly cautionFee legalFee');
    if (!tenant || !tenant.isActive) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    const unit = tenant.unit;
    if (!unit) {
      return res.status(400).json({ success: false, message: 'Tenant is not assigned to any unit' });
    }

    const tenantType = tenant.tenantType || 'new';
    const isExistingLike = ['existing', 'renewal', 'transfer'].includes(tenantType);

    // Determine which charge types apply
    const items = [];

    // Rent is always applicable (ongoing). Base amount is monthly; duration is chosen at payment time.
    if (tenant.rentAmount && tenant.rentAmount > 0) {
      items.push({
        code: 'rent',
        label: 'Rent',
        amount: tenant.rentAmount,
        frequency: 'monthly',
        type: 'recurring'
      });
    }

    // Service charge (monthly) – recurring charge similar to rent
    if (unit.serviceChargeMonthly && unit.serviceChargeMonthly > 0) {
      items.push({
        code: 'service_charge',
        label: 'Service Charge',
        amount: unit.serviceChargeMonthly,
        frequency: 'monthly',
        type: 'recurring'
      });
    }

    // For "new" tenants we also expose caution and legal fees if configured and not yet paid
    if (!isExistingLike) {
      if (unit.cautionFee && unit.cautionFee > 0) {
        const paidCaution = await Payment.exists({
          tenant: tenant._id,
          paymentType: 'caution_fee',
          paymentStatus: 'completed',
          isActive: true,
        });
        if (!paidCaution) {
          items.push({
            code: 'caution_fee',
            label: 'Caution Fee (one-time)',
            amount: unit.cautionFee,
            frequency: 'once',
            type: 'one_time'
          });
        }
      }

      if (unit.legalFee && unit.legalFee > 0) {
        const paidLegal = await Payment.exists({
          tenant: tenant._id,
          paymentType: 'legal_fee',
          paymentStatus: 'completed',
          isActive: true,
        });
        if (!paidLegal) {
          items.push({
            code: 'legal_fee',
            label: 'Legal Fee (one-time)',
            amount: unit.legalFee,
            frequency: 'once',
            type: 'one_time'
          });
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        tenant: {
          id: tenant._id,
          name: tenant.tenantName,
          type: tenant.tenantType,
          unit: unit.label,
        },
        items,
      },
    });
  } catch (err) {
    console.error('List billing items error:', err);
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    res.status(500).json({ success: false, message: 'Server error occurred while fetching billing items' });
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
    // Use an update to avoid re-validating the whole document (which can fail
    // if legacy records are missing newly required fields like `unit`).
    const update = { isActive: false };
    if (req.user?.id) update.updatedBy = req.user.id;

    const tenant = await Tenant.findOneAndUpdate(
      { _id: req.params.id, isActive: true },
      { $set: update },
      { new: true, runValidators: false }
    );

    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    // NOTE: We deliberately do NOT touch the linked unit here.
    // The unit document stays intact and retains its data. If you want
    // to free up the unit, use the remove-tenant endpoint instead.

    return res.status(200).json({ success: true, message: 'Tenant deleted successfully' });
  } catch (err) {
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    console.error('Delete tenant error:', err);
    return res.status(500).json({ success: false, message: 'Server error occurred while deleting tenant' });
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

// Get the logged-in user's tenant record (supports expand like getTenant)
async function getMyTenant(req, res) {
  try {
    const tenant = await Tenant.findOne({ user: req.user.id, isActive: true });
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant record not found for this user' });
    }
    req.params.id = tenant._id.toString();
    return getTenant(req, res);
  } catch (err) {
    console.error('Get my tenant error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// List history for the logged-in tenant
async function listMyHistory(req, res) {
  try {
    const tenant = await Tenant.findOne({ user: req.user.id, isActive: true });
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant record not found for this user' });
    }
    req.params.id = tenant._id.toString();
    return listHistory(req, res);
  } catch (err) {
    console.error('List my history error:', err);
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
  listBillingItems,
  uploadTenantAvatar,
  uploadMyAvatar,
  getMyTenant,
  listMyHistory,
};
