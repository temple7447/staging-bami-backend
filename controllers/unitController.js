const Unit = require('../models/Unit');
const Estate = require('../models/Estate');
const Tenant = require('../models/Tenant');
const { logError, logInfo, logWarning } = require('../utils/logger');

/**
 * Create a new unit for an estate
 */
const createUnit = async (req, res) => {
  try {
    const { estateId } = req.params;
    const {
      label,
      monthlyPrice,
      meterNumber,
      description,
      features,
      serviceChargeMonthly,
      cautionFee,
      legalFee,
    } = req.body;
    const adminId = req.user?._id;

    if (!label || !monthlyPrice) {
      return res.status(400).json({
        success: false,
        message: 'Unit label and monthly price are required'
      });
    }

    if (monthlyPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Monthly price must be greater than 0'
      });
    }

    // Optional billing configuration validation
    const sc = serviceChargeMonthly != null ? Number(serviceChargeMonthly) : undefined;
    const cf = cautionFee != null ? Number(cautionFee) : undefined;
    const lf = legalFee != null ? Number(legalFee) : undefined;

    if ((sc != null && (Number.isNaN(sc) || sc < 0)) ||
        (cf != null && (Number.isNaN(cf) || cf < 0)) ||
        (lf != null && (Number.isNaN(lf) || lf < 0))) {
      return res.status(400).json({
        success: false,
        message: 'Service charge, caution fee and legal fee must be non-negative numbers when provided'
      });
    }

    const estate = await Estate.findById(estateId);
    if (!estate || !estate.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Estate not found'
      });
    }

    const existingUnit = await Unit.findOne({
      estate: estateId,
      label: label,
      isActive: true
    });

    if (existingUnit) {
      return res.status(409).json({
        success: false,
        message: `Unit "${label}" already exists in this estate`
      });
    }

    const unit = new Unit({
      estate: estateId,
      label,
      monthlyPrice,
      meterNumber: meterNumber || '',
      description: description || '',
      features: features || [],
      serviceChargeMonthly: sc != null ? sc : undefined,
      cautionFee: cf != null ? cf : undefined,
      legalFee: lf != null ? lf : undefined,
      createdBy: adminId
    });

    await unit.save();
    await unit.populate('estate', 'name');

    res.status(201).json({
      success: true,
      message: 'Unit created successfully',
      data: {
        unitId: unit._id,
        label: unit.label,
        monthlyPrice: unit.monthlyPrice,
        meterNumber: unit.meterNumber,
        serviceChargeMonthly: unit.serviceChargeMonthly,
        cautionFee: unit.cautionFee,
        legalFee: unit.legalFee,
        status: unit.status,
        estate: unit.estate.name
      }
    });
  } catch (error) {
    logError('POST /api/estates/:estateId/units', error, { estateId, label, monthlyPrice });
    res.status(500).json({
      success: false,
      message: 'Error creating unit',
      error: error.message
    });
  }
};

/**
 * Get all units for an estate
 */
const getEstateUnits = async (req, res) => {
  try {
    const { estateId } = req.params;
    const { status, page = 1, limit = 50 } = req.query;

    const estate = await Estate.findById(estateId);
    if (!estate) {
      return res.status(404).json({
        success: false,
        message: 'Estate not found'
      });
    }

    const filter = { estate: estateId, isActive: true };
    if (status) {
      filter.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [units, total] = await Promise.all([
      Unit.find(filter)
        .populate('occupiedBy', 'tenantName tenantEmail')
        .sort({ label: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Unit.countDocuments(filter)
    ]);

    const summary = {
      totalUnits: total,
      vacant: await Unit.countDocuments({ ...filter, status: 'vacant' }),
      occupied: await Unit.countDocuments({ ...filter, status: 'occupied' }),
      maintenance: await Unit.countDocuments({ ...filter, status: 'maintenance' }),
      reserved: await Unit.countDocuments({ ...filter, status: 'reserved' })
    };

    res.status(200).json({
      success: true,
      data: units.map(unit => ({
        unitId: unit._id,
        label: unit.label,
        monthlyPrice: unit.monthlyPrice,
        meterNumber: unit.meterNumber,
        description: unit.description,
        serviceChargeMonthly: unit.serviceChargeMonthly,
        cautionFee: unit.cautionFee,
        legalFee: unit.legalFee,
        status: unit.status,
        occupiedBy: unit.occupiedBy ? {
          tenantId: unit.occupiedBy._id,
          name: unit.occupiedBy.tenantName,
          email: unit.occupiedBy.tenantEmail
        } : null,
        occupiedSince: unit.occupiedSince,
        createdAt: unit.createdAt
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total
      },
      summary
    });
  } catch (error) {
    logError('GET /api/estates/:estateId/units', error, { estateId, status, page, limit });
    res.status(500).json({
      success: false,
      message: 'Error fetching units',
      error: error.message
    });
  }
};

/**
 * Get vacant units for tenant assignment
 */
const getVacantUnits = async (req, res) => {
  try {
    const { estateId } = req.params;

    const estate = await Estate.findById(estateId);
    if (!estate) {
      return res.status(404).json({
        success: false,
        message: 'Estate not found'
      });
    }

    const vacantUnits = await Unit.find({
      estate: estateId,
      status: { $in: ['vacant', 'reserved'] },
      isActive: true
    }).sort({ label: 1 });

    res.status(200).json({
      success: true,
      data: vacantUnits.map(unit => ({
        unitId: unit._id,
        label: unit.label,
        monthlyPrice: unit.monthlyPrice,
        meterNumber: unit.meterNumber,
        status: unit.status,
        description: unit.description,
        serviceChargeMonthly: unit.serviceChargeMonthly,
        cautionFee: unit.cautionFee,
        legalFee: unit.legalFee,
      })),
      total: vacantUnits.length
    });
  } catch (error) {
    logError('GET /api/estates/:estateId/units/vacant', error, { estateId });
    res.status(500).json({
      success: false,
      message: 'Error fetching vacant units',
      error: error.message
    });
  }
};

/**
 * Assign a tenant to a unit
 */
const assignTenantToUnit = async (req, res) => {
  try {
    const { estateId, unitId } = req.params;
    const { tenantId } = req.body;

    if (!tenantId) {
      return res.status(400).json({
        success: false,
        message: 'Tenant ID is required'
      });
    }

    // Verify estate exists
    const estate = await Estate.findById(estateId);
    if (!estate || !estate.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Estate not found'
      });
    }

    // Verify unit exists and belongs to the estate
    const unit = await Unit.findOne({ _id: unitId, estate: estateId, isActive: true });
    if (!unit) {
      return res.status(404).json({
        success: false,
        message: 'Unit not found in this estate'
      });
    }

    // Check if unit is already occupied
    if (unit.status === 'occupied') {
      return res.status(409).json({
        success: false,
        message: 'This unit is already occupied'
      });
    }

    // Verify tenant exists
    const tenant = await Tenant.findById(tenantId);
    if (!tenant || !tenant.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Tenant not found'
      });
    }

    // Check if tenant is already assigned to a unit
    if (tenant.status === 'occupied') {
      return res.status(409).json({
        success: false,
        message: 'Tenant is already assigned to another unit'
      });
    }

    // Update unit
    unit.occupiedBy = tenantId;
    unit.status = 'occupied';
    unit.occupiedSince = new Date();
    unit.updatedBy = req.user?._id;
    await unit.save();

    // Update tenant
    tenant.status = 'occupied';
    tenant.updatedBy = req.user?._id;
    if (!tenant.history) tenant.history = [];
    tenant.history.push({
      event: 'moved_in',
      note: `Tenant assigned to unit ${unit.label}`,
      meta: { unitId: unit._id, unitLabel: unit.label },
      createdBy: req.user?._id
    });
    await tenant.save();

    res.status(200).json({
      success: true,
      message: 'Tenant assigned to unit successfully',
      data: {
        unitId: unit._id,
        unitLabel: unit.label,
        tenantId: tenant._id,
        tenantName: tenant.tenantName,
        occupiedSince: unit.occupiedSince
      }
    });
  } catch (error) {
    console.error('Assign tenant to unit error:', error);
    res.status(500).json({
      success: false,
      message: 'Error assigning tenant to unit',
      error: error.message
    });
  }
};

/**
 * Remove tenant from a unit (make unit vacant but keep tenant record)
 */
const removeTenantFromUnit = async (req, res) => {
  try {
    const { unitId } = req.params;

    // Find unit with an occupied tenant
    const unit = await Unit.findOne({ _id: unitId, isActive: true }).populate('occupiedBy');
    if (!unit) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }

    if (!unit.occupiedBy) {
      return res.status(400).json({ success: false, message: 'Unit is already vacant' });
    }

    const tenantId = unit.occupiedBy._id;

    // Free up the unit
    unit.occupiedBy = null;
    unit.status = 'vacant';
    unit.occupiedSince = null;
    unit.updatedBy = req.user?._id;
    await unit.save();

    // Optionally update tenant status but DO NOT delete tenant or its unit reference
    await Tenant.findByIdAndUpdate(tenantId, {
      status: 'pending',
      updatedBy: req.user?._id,
    });

    return res.status(200).json({ success: true, message: 'Tenant removed from unit successfully' });
  } catch (error) {
    console.error('Remove tenant from unit error:', error);
    res.status(500).json({
      success: false,
      message: 'Error removing tenant from unit',
      error: error.message,
    });
  }
};

module.exports = {
  createUnit,
  getEstateUnits,
  getVacantUnits,
  assignTenantToUnit,
  removeTenantFromUnit,
};
