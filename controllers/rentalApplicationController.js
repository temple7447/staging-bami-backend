const RentalApplication = require('../models/RentalApplication');
const Estate = require('../models/Estate');
const Unit = require('../models/Unit');

// @desc  Submit a rental application (public — no auth required)
// @route POST /api/rental-applications
exports.submitApplication = async (req, res) => {
  try {
    const {
      estateId,
      unitId,
      fullName,
      email,
      phone,
      dateOfBirth,
      nationality,
      currentAddress,
      stateOfOrigin,
      employmentStatus,
      employer,
      jobTitle,
      monthlyIncome,
      nextOfKinName,
      nextOfKinPhone,
      nextOfKinRelationship,
      preferredMoveInDate,
      numberOfOccupants,
      hasPets,
      additionalNotes
    } = req.body;

    // Verify estate exists
    const estate = await Estate.findById(estateId).select('_id name').lean();
    if (!estate) {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }

    // If a specific unit is requested, verify it belongs to this estate
    let unitDoc = null;
    if (unitId) {
      unitDoc = await Unit.findOne({ _id: unitId, estate: estateId }).select('_id label status').lean();
      if (!unitDoc) {
        return res.status(404).json({ success: false, message: 'Unit not found in this estate' });
      }
    }

    const application = await RentalApplication.create({
      estate: estateId,
      unit: unitId || undefined,
      fullName,
      email,
      phone,
      dateOfBirth,
      nationality,
      currentAddress,
      stateOfOrigin,
      employmentStatus,
      employer,
      jobTitle,
      monthlyIncome,
      nextOfKinName,
      nextOfKinPhone,
      nextOfKinRelationship,
      preferredMoveInDate,
      numberOfOccupants,
      hasPets,
      additionalNotes
    });

    res.status(201).json({
      success: true,
      message: 'Application submitted successfully. The property owner will review your application and get back to you.',
      data: {
        applicationId: application._id,
        fullName: application.fullName,
        email: application.email,
        estateName: estate.name,
        unitLabel: unitDoc?.label || null,
        status: application.status,
        submittedAt: application.createdAt
      }
    });
  } catch (error) {
    if (error.name === 'ValidationError') {
      const messages = Object.values(error.errors).map(e => e.message);
      return res.status(400).json({ success: false, message: messages.join('. ') });
    }
    console.error('submitApplication error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc  Get all applications for estates owned/managed by the logged-in user
// @route GET /api/rental-applications
// @access Protected (admin, superadmin, business_owner, manager)
exports.getApplications = async (req, res) => {
  try {
    const {
      estateId,
      unitId,
      status,
      page = 1,
      limit = 20,
      search
    } = req.query;

    const filter = { isActive: true };

    // Scope by role — superadmin/admin see all; others see only their estates
    if (!['super_admin', 'admin'].includes(req.user.role)) {
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
      filter.$or = [
        { fullName: regex },
        { email: regex },
        { phone: regex }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const total = await RentalApplication.countDocuments(filter);

    const applications = await RentalApplication.find(filter)
      .populate('estate', 'name address')
      .populate('unit', 'label category bedrooms bathrooms monthlyPrice')
      .populate('reviewedBy', 'name email')
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit))
      .lean();

    res.status(200).json({
      success: true,
      count: applications.length,
      total,
      pages: Math.ceil(total / parseInt(limit)),
      currentPage: parseInt(page),
      data: applications
    });
  } catch (error) {
    console.error('getApplications error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc  Get a single application by ID
// @route GET /api/rental-applications/:id
// @access Protected
exports.getApplication = async (req, res) => {
  try {
    const application = await RentalApplication.findById(req.params.id)
      .populate('estate', 'name address owner')
      .populate('unit', 'label category bedrooms bathrooms monthlyPrice serviceChargeMonthly cautionFee legalFee')
      .populate('reviewedBy', 'name email')
      .lean();

    if (!application || !application.isActive) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    // Non-admins can only view applications on their own estates
    if (!['super_admin', 'admin'].includes(req.user.role)) {
      const estateOwnerId = application.estate?.owner?.toString();
      if (estateOwnerId !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorised to view this application' });
      }
    }

    res.status(200).json({ success: true, data: application });
  } catch (error) {
    console.error('getApplication error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc  Update application status (approve / reject / waitlist / under_review)
// @route PATCH /api/rental-applications/:id/status
// @access Protected
exports.updateApplicationStatus = async (req, res) => {
  try {
    const { status, statusNote } = req.body;

    const allowed = ['pending', 'under_review', 'approved', 'rejected', 'waitlisted'];
    if (!allowed.includes(status)) {
      return res.status(400).json({ success: false, message: `Status must be one of: ${allowed.join(', ')}` });
    }

    const application = await RentalApplication.findById(req.params.id)
      .populate('estate', 'owner');

    if (!application || !application.isActive) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    // Non-admins can only update applications on their estates
    if (!['super_admin', 'admin'].includes(req.user.role)) {
      const estateOwnerId = application.estate?.owner?.toString();
      if (estateOwnerId !== req.user._id.toString()) {
        return res.status(403).json({ success: false, message: 'Not authorised to update this application' });
      }
    }

    application.status = status;
    if (statusNote !== undefined) application.statusNote = statusNote;
    application.reviewedBy = req.user._id;
    application.reviewedAt = new Date();

    await application.save();

    res.status(200).json({
      success: true,
      message: `Application ${status}`,
      data: {
        _id: application._id,
        fullName: application.fullName,
        email: application.email,
        status: application.status,
        statusNote: application.statusNote,
        reviewedAt: application.reviewedAt
      }
    });
  } catch (error) {
    console.error('updateApplicationStatus error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};

// @desc  Delete (soft-delete) an application
// @route DELETE /api/rental-applications/:id
// @access Protected (admin/superadmin only)
exports.deleteApplication = async (req, res) => {
  try {
    const application = await RentalApplication.findById(req.params.id);

    if (!application || !application.isActive) {
      return res.status(404).json({ success: false, message: 'Application not found' });
    }

    application.isActive = false;
    await application.save();

    res.status(200).json({ success: true, message: 'Application removed' });
  } catch (error) {
    console.error('deleteApplication error:', error);
    res.status(500).json({ success: false, message: 'Server error' });
  }
};
