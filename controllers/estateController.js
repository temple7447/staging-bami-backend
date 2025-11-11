const Estate = require('../models/Estate');
const Tenant = require('../models/Tenant');
const Transaction = require('../models/Transaction');
const { validationResult } = require('express-validator');
const { logError, logInfo, logWarning } = require('../utils/logger');

// Create estate
const createEstate = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const { name, description, totalUnits } = req.body;

    // Check duplicate (active)
    const existing = await Estate.findOne({ name: new RegExp(`^${name}$`, 'i'), isActive: true });
    if (existing) {
      return res.status(400).json({ success: false, message: 'An estate with this name already exists' });
    }

    const estate = await Estate.create({
      name,
      description,
      totalUnits,
      createdBy: req.user?.id,
    });

    res.status(201).json({ success: true, message: 'Estate created successfully', data: estate });
  } catch (err) {
    logError('POST /api/estates', err, { name, description, totalUnits });
    if (err.name === 'ValidationError') {
      logWarning('Validation error on estate creation', { message: err.message });
      return res.status(400).json({ success: false, message: err.message });
    }
    res.status(500).json({ success: false, message: 'Server error occurred while creating estate' });
  }
};

// List estates
const getEstates = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query;

    const filter = { isActive: true };
    if (search) {
      filter.name = new RegExp(search, 'i');
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [items, total] = await Promise.all([
      Estate.find(filter).sort({ createdAt: -1 }).skip(skip).limit(parseInt(limit)),
      Estate.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: items,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (err) {
    logError('GET /api/estates', err, { page, limit, search });
    res.status(500).json({ success: false, message: 'Server error occurred while fetching estates' });
  }
};

// Get single estate
const getEstate = async (req, res) => {
  try {
    const estate = await Estate.findById(req.params.id);
    if (!estate || !estate.isActive) {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }
    res.status(200).json({ success: true, data: estate });
  } catch (err) {
    logError('GET /api/estates/:id', err, { estateId: req.params.id });
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }
    res.status(500).json({ success: false, message: 'Server error occurred while fetching estate' });
  }
};

// Update estate
const updateEstate = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const estate = await Estate.findById(req.params.id);
    if (!estate || !estate.isActive) {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }

    const { name, description, totalUnits } = req.body;

    // Duplicate check when changing name
    if (name && name !== estate.name) {
      const existing = await Estate.findOne({ name: new RegExp(`^${name}$`, 'i'), isActive: true, _id: { $ne: estate._id } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'An estate with this name already exists' });
      }
      estate.name = name;
    }
    if (description !== undefined) estate.description = description;
    if (totalUnits !== undefined) estate.totalUnits = parseInt(totalUnits);
    if (req.user?.id) estate.updatedBy = req.user.id;

    await estate.save();

    res.status(200).json({ success: true, message: 'Estate updated successfully', data: estate });
  } catch (err) {
    logError('PUT /api/estates/:id', err, { estateId: req.params.id, name, totalUnits });
    if (err.name === 'ValidationError') {
      logWarning('Validation error on estate update', { message: err.message });
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }
    res.status(500).json({ success: false, message: 'Server error occurred while updating estate' });
  }
};

// Estate overview
const getEstateOverview = async (req, res) => {
  try {
    const estate = await Estate.findById(req.params.id);
    if (!estate || !estate.isActive) {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }

    const [occupiedCount, tenantsDueSoon, last30RevenueAgg] = await Promise.all([
      Tenant.countDocuments({ estate: estate._id, isActive: true, status: { $in: ['occupied','pending'] } }),
      Tenant.countDocuments({ estate: estate._id, isActive: true, nextDueDate: { $gte: new Date(), $lte: new Date(Date.now() + 30*24*60*60*1000) } }),
      Transaction.aggregate([
        { $match: { estate: estate._id, isActive: true, status: 'paid', createdAt: { $gte: new Date(Date.now() - 30*24*60*60*1000) } } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } }
      ])
    ]);

    const totalUnits = estate.totalUnits || 0;
    const occupiedUnits = occupiedCount;
    const vacantUnits = Math.max(totalUnits - occupiedUnits, 0);

    const revenue30 = last30RevenueAgg[0]?.total || 0;
    const txCount30 = last30RevenueAgg[0]?.count || 0;

    return res.status(200).json({
      success: true,
      data: {
        estate: { _id: estate._id, name: estate.name, totalUnits, createdAt: estate.createdAt },
        occupancy: { totalUnits, occupiedUnits, vacantUnits, occupancyRate: totalUnits > 0 ? occupiedUnits / totalUnits : 0 },
        billing: { upcomingDueCount: tenantsDueSoon, last30d: { revenue: revenue30, transactions: txCount30 } }
      }
    });
  } catch (err) {
    logError('GET /api/estates/:id/overview', err, { estateId: req.params.id });
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }
    res.status(500).json({ success: false, message: 'Server error occurred while fetching estate overview' });
  }
};

// Delete (soft)
const deleteEstate = async (req, res) => {
  try {
    const estate = await Estate.findById(req.params.id);
    if (!estate || !estate.isActive) {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }

    estate.isActive = false;
    if (req.user?.id) estate.updatedBy = req.user.id;
    await estate.save();

    res.status(200).json({ success: true, message: 'Estate deleted successfully' });
  } catch (err) {
    logError('DELETE /api/estates/:id', err, { estateId: req.params.id });
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }
    res.status(500).json({ success: false, message: 'Server error occurred while deleting estate' });
  }
};

module.exports = {
  createEstate,
  getEstates,
  getEstate,
  updateEstate,
  deleteEstate,
  getEstateOverview,
};
