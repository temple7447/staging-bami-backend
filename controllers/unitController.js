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
      category,
      listingType,
      securityDeposit,
      availableDate,
      bedrooms,
      bathrooms,
      area,
      amenities,
      streetAddress,
      images,
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
      category,
      listingType,
      securityDeposit,
      availableDate,
      bedrooms,
      bathrooms,
      area,
      amenities,
      streetAddress,
      images,
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
        category: unit.category,
        listingType: unit.listingType,
        securityDeposit: unit.securityDeposit,
        availableDate: unit.availableDate,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        area: unit.area,
        amenities: unit.amenities,
        streetAddress: unit.streetAddress,
        images: unit.images,
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
      data: units.map(unit => {
        const { getCurrentRent } = require('../utils/rentCalculator');
        const isVacant = unit.status === 'vacant';
        const effectiveOrigin = unit.lastRentIncreaseDate || unit.createdAt || new Date('2024-01-01');

        const currentPrice = getCurrentRent(
          unit.basePrice2024 || unit.monthlyPrice,
          effectiveOriginRent,
          isVacant
        );

        const currentService = getCurrentRent(
          unit.baseServiceCharge2024 || unit.serviceChargeMonthly,
          unit.lastServiceIncreaseDate || unit.createdAt || new Date('2024-01-01'),
          isVacant
        );

        return {
          unitId: unit._id,
          label: unit.label,
          monthlyPrice: unit.monthlyPrice,
          currentEffectivePrice: currentPrice,
          isRentIncreased: currentPrice > (unit.basePrice2024 || unit.monthlyPrice),
          serviceChargeMonthly: unit.serviceChargeMonthly,
          currentEffectiveService: currentService,
          isServiceIncreased: currentService > (unit.baseServiceCharge2024 || unit.serviceChargeMonthly),
          meterNumber: unit.meterNumber,
          description: unit.description,
          cautionFee: unit.cautionFee,
          legalFee: unit.legalFee,
          status: unit.status,
          category: unit.category,
          listingType: unit.listingType,
          securityDeposit: unit.securityDeposit,
          availableDate: unit.availableDate,
          bedrooms: unit.bedrooms,
          bathrooms: unit.bathrooms,
          area: unit.area,
          amenities: unit.amenities,
          streetAddress: unit.streetAddress,
          images: unit.images,
          occupiedBy: unit.occupiedBy ? {
            tenantId: unit.occupiedBy._id,
            name: unit.occupiedBy.tenantName,
            email: unit.occupiedBy.tenantEmail
          } : null,
          occupiedSince: unit.occupiedSince,
          createdAt: unit.createdAt
        };
      }),
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
      data: vacantUnits.map(unit => {
        const { getCurrentRent } = require('../utils/rentCalculator');
        const effectiveOriginRent = unit.lastRentIncreaseDate || unit.createdAt || new Date('2024-01-01');
        const effectiveOriginService = unit.lastServiceIncreaseDate || unit.createdAt || new Date('2024-01-01');

        const currentPrice = getCurrentRent(
          unit.basePrice2024 || unit.monthlyPrice,
          effectiveOriginRent,
          true // Vacant cycle
        );

        const currentService = getCurrentRent(
          unit.baseServiceCharge2024 || unit.serviceChargeMonthly,
          effectiveOriginService,
          true // Vacant cycle
        );

        return {
          unitId: unit._id,
          label: unit.label,
          monthlyPrice: unit.monthlyPrice,
          currentEffectivePrice: currentPrice,
          isRentIncreased: currentPrice > (unit.basePrice2024 || unit.monthlyPrice),
          serviceChargeMonthly: unit.serviceChargeMonthly,
          currentEffectiveService: currentService,
          isServiceIncreased: currentService > (unit.baseServiceCharge2024 || unit.serviceChargeMonthly),
          meterNumber: unit.meterNumber,
          status: unit.status,
          description: unit.description,
          cautionFee: unit.cautionFee,
          legalFee: unit.legalFee,
        };
      }),
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
 * Get details for a single unit
 */
const getUnitDetails = async (req, res) => {
  try {
    const { unitId } = req.params;
    const unit = await Unit.findById(unitId).populate('estate', 'name');
    if (!unit || !unit.isActive) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }

    const { getCurrentRent } = require('../utils/rentCalculator');
    const isVacant = unit.status === 'vacant';
    const effectiveOriginRent = unit.lastRentIncreaseDate || unit.createdAt || new Date('2024-01-01');
    const effectiveOriginService = unit.lastServiceIncreaseDate || unit.createdAt || new Date('2024-01-01');

    const currentPrice = getCurrentRent(
      unit.basePrice2024 || unit.monthlyPrice,
      effectiveOriginRent,
      isVacant
    );

    const currentService = getCurrentRent(
      unit.baseServiceCharge2024 || unit.serviceChargeMonthly,
      effectiveOriginService,
      isVacant
    );

    return res.status(200).json({
      success: true,
      data: {
        unitId: unit._id,
        label: unit.label,
        monthlyPrice: unit.monthlyPrice,
        currentEffectivePrice: currentPrice,
        isRentIncreased: currentPrice > (unit.basePrice2024 || unit.monthlyPrice),
        serviceChargeMonthly: unit.serviceChargeMonthly,
        currentEffectiveService: currentService,
        isServiceIncreased: currentService > (unit.baseServiceCharge2024 || unit.serviceChargeMonthly),
        meterNumber: unit.meterNumber,
        description: unit.description,
        serviceChargeMonthly: unit.serviceChargeMonthly,
        cautionFee: unit.cautionFee,
        legalFee: unit.legalFee,
        status: unit.status,
        category: unit.category,
        listingType: unit.listingType,
        securityDeposit: unit.securityDeposit,
        availableDate: unit.availableDate,
        bedrooms: unit.bedrooms,
        bathrooms: unit.bathrooms,
        area: unit.area,
        amenities: unit.amenities,
        streetAddress: unit.streetAddress,
        images: unit.images,
        estate: unit.estate ? { id: unit.estate._id, name: unit.estate.name } : null,
        occupiedBy: unit.occupiedBy,
        occupiedSince: unit.occupiedSince,
        createdAt: unit.createdAt,
        updatedAt: unit.updatedAt,
      },
    });
  } catch (error) {
    logError('GET /api/estates/unit/:unitId', error, { unitId: req.params.unitId });
    return res.status(500).json({ success: false, message: 'Error fetching unit details' });
  }
};

/**
 * Update a unit (pricing & basic info) without changing its ID
 */
const updateUnit = async (req, res) => {
  try {
    const { unitId } = req.params;
    const unit = await Unit.findById(unitId);
    if (!unit || !unit.isActive) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }

    const {
      label,
      monthlyPrice,
      meterNumber,
      description,
      features,
      serviceChargeMonthly,
      cautionFee,
      legalFee,
      status,
      category,
      listingType,
      securityDeposit,
      availableDate,
      bedrooms,
      bathrooms,
      area,
      amenities,
      streetAddress,
      images,
    } = req.body;

    // If label is changing, enforce uniqueness within estate for active units
    if (label && label !== unit.label) {
      const existing = await Unit.findOne({
        _id: { $ne: unitId },
        estate: unit.estate,
        label,
        isActive: true,
      });
      if (existing) {
        return res.status(409).json({
          success: false,
          message: `Another unit with label "${label}" already exists in this estate`,
        });
      }
      unit.label = label;
    }

    // Pricing fields: coerce to numbers and validate non-negative
    const mp = monthlyPrice != null ? Number(monthlyPrice) : undefined;
    const sc = serviceChargeMonthly != null ? Number(serviceChargeMonthly) : undefined;
    const cf = cautionFee != null ? Number(cautionFee) : undefined;
    const lf = legalFee != null ? Number(legalFee) : undefined;

    if (mp != null && (Number.isNaN(mp) || mp <= 0)) {
      return res.status(400).json({ success: false, message: 'Monthly price must be a positive number' });
    }
    if ((sc != null && (Number.isNaN(sc) || sc < 0)) ||
      (cf != null && (Number.isNaN(cf) || cf < 0)) ||
      (lf != null && (Number.isNaN(lf) || lf < 0))) {
      return res.status(400).json({
        success: false,
        message: 'Service charge, caution fee and legal fee must be non-negative numbers when provided',
      });
    }

    if (mp != null) unit.monthlyPrice = mp;
    if (sc != null) unit.serviceChargeMonthly = sc;
    if (cf != null) unit.cautionFee = cf;
    if (lf != null) unit.legalFee = lf;

    if (meterNumber !== undefined) unit.meterNumber = meterNumber;
    if (description !== undefined) unit.description = description;
    if (features !== undefined) unit.features = features;
    if (status !== undefined) unit.status = status;
    if (category !== undefined) unit.category = category;
    if (listingType !== undefined) unit.listingType = listingType;
    if (securityDeposit !== undefined) unit.securityDeposit = securityDeposit;
    if (availableDate !== undefined) unit.availableDate = availableDate;
    if (bedrooms !== undefined) unit.bedrooms = bedrooms;
    if (bathrooms !== undefined) unit.bathrooms = bathrooms;
    if (area !== undefined) unit.area = area;
    if (amenities !== undefined) unit.amenities = amenities;
    if (streetAddress !== undefined) unit.streetAddress = streetAddress;
    if (images !== undefined) unit.images = images;

    unit.updatedBy = req.user?._id;
    await unit.save();

    // Keep active tenants in this unit in sync with the unit's monthlyPrice
    if (mp != null) {
      await Tenant.updateMany(
        { unit: unit._id, isActive: true },
        { $set: { rentAmount: mp, updatedBy: req.user?._id } }
      );
    }

    return res.status(200).json({ success: true, message: 'Unit updated successfully', data: unit });
  } catch (error) {
    logError('PUT /api/estates/unit/:unitId', error, { unitId: req.params.unitId });
    return res.status(500).json({ success: false, message: 'Error updating unit' });
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

    // Mark previous tenant as inactive so a new tenant can be created
    // for the same unit (unique index is on estate+unitLabel+isActive=true).
    await Tenant.findByIdAndUpdate(tenantId, {
      status: 'vacant',
      isActive: false,
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

/**
 * Get all vacant properties for the general public (no auth)
 */
const getPublicListings = async (req, res) => {
  try {
    const {
      page = 1,
      limit = 20,
      category,
      listingType,
      minPrice,
      maxPrice,
      bedrooms,
      bathrooms,
      search,
    } = req.query;

    const filter = {
      isActive: true,
      status: 'vacant'
    };

    if (category) filter.category = category;
    if (listingType) filter.listingType = listingType;
    if (bedrooms) filter.bedrooms = { $gte: parseInt(bedrooms) };
    if (bathrooms) filter.bathrooms = { $gte: parseInt(bathrooms) };

    if (minPrice || maxPrice) {
      filter.monthlyPrice = {};
      if (minPrice) filter.monthlyPrice.$gte = parseFloat(minPrice);
      if (maxPrice) filter.monthlyPrice.$lte = parseFloat(maxPrice);
    }

    if (search) {
      filter.$or = [
        { label: new RegExp(search, 'i') },
        { streetAddress: new RegExp(search, 'i') },
        { description: new RegExp(search, 'i') }
      ];
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [units, total] = await Promise.all([
      Unit.find(filter)
        .populate('estate', 'name')
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Unit.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      count: units.length,
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total
      },
      data: units
    });
  } catch (error) {
    logError('GET /api/public/listings', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching properties',
      error: error.message
    });
  }
};

/**
 * Get single property detail for the general public (no auth)
 */
const getPublicListingDetail = async (req, res) => {
  try {
    const { id } = req.params;
    const unit = await Unit.findOne({ _id: id, isActive: true, status: 'vacant' })
      .populate('estate', 'name');

    if (!unit) {
      return res.status(404).json({
        success: false,
        message: 'Property not found or no longer available'
      });
    }

    res.status(200).json({
      success: true,
      data: unit
    });
  } catch (error) {
    logError('GET /api/public/listings/:id', error, { id });
    res.status(500).json({
      success: false,
      message: 'Error fetching property details'
    });
  }
};

/**
 * Delete a unit (soft delete)
 */
const deleteUnit = async (req, res) => {
  try {
    const { unitId } = req.params;
    const unit = await Unit.findById(unitId);

    if (!unit || !unit.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Unit not found'
      });
    }

    // Check if unit is occupied
    if (unit.status === 'occupied') {
      return res.status(400).json({
        success: false,
        message: 'Cannot delete an occupied unit. Please remove the tenant first.'
      });
    }

    // Perform soft delete
    unit.isActive = false;
    unit.updatedBy = req.user?._id;
    await unit.save();

    res.status(200).json({
      success: true,
      message: 'Unit deleted successfully'
    });
  } catch (error) {
    logError('DELETE /api/estates/unit/:unitId', error, { unitId: req.params.unitId });
    res.status(500).json({
      success: false,
      message: 'Error deleting unit'
    });
  }
};

module.exports = {
  createUnit,
  getEstateUnits,
  getVacantUnits,
  getUnitDetails,
  updateUnit,
  assignTenantToUnit,
  removeTenantFromUnit,
  getPublicListings,
  getPublicListingDetail,
  deleteUnit,
};
