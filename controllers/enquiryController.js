const Enquiry = require('../models/Enquiry');
const Estate = require('../models/Estate');
const Unit = require('../models/Unit');

// @desc  Submit a public enquiry about a property/unit
// @route POST /api/enquiries
// @access Public
exports.submitEnquiry = async (req, res) => {
  try {
    const { name, email, message, estateId, unitId } = req.body;

    if (!name || !email || !message || !estateId) {
      return res.status(400).json({
        success: false,
        message: 'name, email, message, and estateId are required'
      });
    }

    const estate = await Estate.findById(estateId).select('_id name').lean();
    if (!estate) {
      return res.status(404).json({ success: false, message: 'Property not found' });
    }

    if (unitId) {
      const unitExists = await Unit.exists({ _id: unitId, estate: estateId });
      if (!unitExists) {
        return res.status(404).json({ success: false, message: 'Unit not found in this property' });
      }
    }

    const enquiry = await Enquiry.create({
      estate: estateId,
      unit: unitId || undefined,
      name,
      email,
      message
    });

    res.status(201).json({
      success: true,
      message: 'Message sent! The property owner will get back to you shortly.',
      data: {
        enquiryId: enquiry._id,
        name: enquiry.name,
        email: enquiry.email,
        estateName: estate.name,
        submittedAt: enquiry.createdAt
      }
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: messages.join('. ') });
    }
    if (error.name === 'CastError') {
      return res.status(400).json({ success: false, message: 'Invalid estate or unit ID' });
    }
    console.error('submitEnquiry error:', error);
    res.status(500).json({ success: false, message: 'Failed to send message. Please try again.' });
  }
};

// @desc  Get all enquiries (scoped to owned estates for non-admins)
// @route GET /api/enquiries
// @access Protected
exports.getEnquiries = async (req, res) => {
  try {
    const { estateId, unitId, status, page = 1, limit = 20, search } = req.query;

    const filter = { isActive: true };

    if (!['superadmin', 'admin'].includes(req.user.role)) {
      const ownedEstates = await Estate.find({ owner: req.user._id, isActive: true }).select('_id').lean();
      const estateIds = ownedEstates.map(e => e._id);

      if (estateIds.length === 0) {
        return res.status(200).json({ success: true, count: 0, total: 0, pages: 0, data: [] });
      }

      filter.estate = estateId && estateIds.some(id => id.toString() === estateId)
        ? estateId
        : { $in: estateIds };
    } else if (estateId) {
      filter.estate = estateId;
    }

    if (unitId) filter.unit = unitId;
    if (status) filter.status = status;

    if (search) {
      const regex = new RegExp(search, 'i');
      filter.$or = [{ name: regex }, { email: regex }, { message: regex }];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await Enquiry.countDocuments(filter);

    const enquiries = await Enquiry.find(filter)
      .populate('estate', 'name')
      .populate('unit', 'label category')
      .populate('repliedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.status(200).json({
      success: true,
      count: enquiries.length,
      total,
      pages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      data: enquiries
    });
  } catch (error) {
    console.error('getEnquiries error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc  Get a single enquiry
// @route GET /api/enquiries/:id
// @access Protected
exports.getEnquiry = async (req, res) => {
  try {
    const enquiry = await Enquiry.findById(req.params.id)
      .populate('estate', 'name owner')
      .populate('unit', 'label category monthlyPrice')
      .populate('repliedBy', 'name email')
      .lean();

    if (!enquiry || !enquiry.isActive) {
      return res.status(404).json({ success: false, message: 'Enquiry not found' });
    }

    if (!['superadmin', 'admin'].includes(req.user.role)) {
      const estateOwnerId = enquiry.estate?.owner?.toString();
      if (estateOwnerId !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorised to view this enquiry' });
      }
    }

    // Auto-mark as read when viewed
    if (enquiry.status === 'new') {
      await Enquiry.findByIdAndUpdate(req.params.id, { status: 'read' });
      enquiry.status = 'read';
    }

    res.status(200).json({ success: true, data: enquiry });
  } catch (error) {
    console.error('getEnquiry error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc  Update enquiry status
// @route PATCH /api/enquiries/:id/status
// @access Protected
exports.updateEnquiryStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ['new', 'read', 'replied', 'archived'];

    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of: ${allowed.join(', ')}` });
    }

    const enquiry = await Enquiry.findById(req.params.id).populate('estate', 'owner');

    if (!enquiry || !enquiry.isActive) {
      return res.status(404).json({ success: false, message: 'Enquiry not found' });
    }

    if (!['superadmin', 'admin'].includes(req.user.role)) {
      const estateOwnerId = enquiry.estate?.owner?.toString();
      if (estateOwnerId !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorised to update this enquiry' });
      }
    }

    enquiry.status = status;
    if (status === 'replied') {
      enquiry.repliedBy = req.user._id;
      enquiry.repliedAt = new Date();
    }
    await enquiry.save();

    res.status(200).json({ success: true, message: `Enquiry marked as ${status}`, data: { _id: enquiry._id, status: enquiry.status } });
  } catch (error) {
    console.error('updateEnquiryStatus error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc  Delete (soft-delete) an enquiry
// @route DELETE /api/enquiries/:id
// @access Protected
exports.deleteEnquiry = async (req, res) => {
  try {
    const enquiry = await Enquiry.findById(req.params.id).populate('estate', 'owner');

    if (!enquiry || !enquiry.isActive) {
      return res.status(404).json({ success: false, message: 'Enquiry not found' });
    }

    if (!['superadmin', 'admin'].includes(req.user.role)) {
      const estateOwnerId = enquiry.estate?.owner?.toString();
      if (estateOwnerId !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorised to delete this enquiry' });
      }
    }

    enquiry.isActive = false;
    await enquiry.save();

    res.status(200).json({ success: true, message: 'Enquiry deleted' });
  } catch (error) {
    console.error('deleteEnquiry error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
