const Estate = require('../models/Estate');
const { validationResult } = require('express-validator');

// Create estate
const createEstate = async (req, res) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ success: false, message: 'Validation errors', errors: errors.array() });
    }

    const { name, description } = req.body;

    // Check duplicate (active)
    const existing = await Estate.findOne({ name: new RegExp(`^${name}$`, 'i'), isActive: true });
    if (existing) {
      return res.status(400).json({ success: false, message: 'An estate with this name already exists' });
    }

    const estate = await Estate.create({
      name,
      description,
      createdBy: req.user?.id,
    });

    res.status(201).json({ success: true, message: 'Estate created successfully', data: estate });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: err.message });
    }
    console.error('Create estate error:', err);
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
    console.error('Get estates error:', err);
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
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }
    console.error('Get estate error:', err);
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

    const { name, description } = req.body;

    // Duplicate check when changing name
    if (name && name !== estate.name) {
      const existing = await Estate.findOne({ name: new RegExp(`^${name}$`, 'i'), isActive: true, _id: { $ne: estate._id } });
      if (existing) {
        return res.status(400).json({ success: false, message: 'An estate with this name already exists' });
      }
      estate.name = name;
    }
    if (description !== undefined) estate.description = description;
    if (req.user?.id) estate.updatedBy = req.user.id;

    await estate.save();

    res.status(200).json({ success: true, message: 'Estate updated successfully', data: estate });
  } catch (err) {
    if (err.name === 'ValidationError') {
      return res.status(400).json({ success: false, message: err.message });
    }
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }
    console.error('Update estate error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while updating estate' });
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
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }
    console.error('Delete estate error:', err);
    res.status(500).json({ success: false, message: 'Server error occurred while deleting estate' });
  }
};

module.exports = {
  createEstate,
  getEstates,
  getEstate,
  updateEstate,
  deleteEstate,
};
