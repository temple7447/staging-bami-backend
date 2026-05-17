const Unit = require('../models/Unit');
const Estate = require('../models/Estate');
const Tenant = require('../models/Tenant');
const { logError, logInfo, logWarning } = require('../utils/logger');
const { cloudinary, ensureCloudinaryConfigured } = require('../config/cloudinary');

function uploadBufferToCloudinary(buffer, options) {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(options, (err, result) => {
      if (err) return reject(err);
      resolve(result);
    });
    stream.end(buffer);
  });
}

/**
 * Create a new unit for an estate
 */
const createUnit = async (req, res) => {
  const { estateId } = req.params;
  try {
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
      availableDate,
      bedrooms,
      bathrooms,
      area,
      amenities,
      streetAddress,
      images,
    } = req.body;
    const adminId = req.user?._id;

    const normalizeImages = (raw) => {
      if (!Array.isArray(raw)) return [];
      return raw.map(img =>
        typeof img === 'string'
          ? { url: img }
          : { url: img.url || img.secure_url, publicId: img.publicId || img.public_id || undefined, caption: img.caption || undefined }
      ).filter(img => img.url);
    };

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
      availableDate,
      bedrooms,
      bathrooms,
      area,
      amenities,
      streetAddress,
      images: normalizeImages(images),
      createdBy: adminId,
      // Initialize base pricing for 26% rule
      basePrice2024: monthlyPrice,
      lastRentIncreaseDate: new Date(),
      baseServiceCharge2024: sc != null ? sc : 0,
      lastServiceIncreaseDate: new Date(),
      baseCaution2024: cf != null ? cf : 0,
      lastCautionIncreaseDate: new Date(),
      baseLegal2024: lf != null ? lf : 0,
      lastLegalIncreaseDate: new Date()
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
  const { estateId } = req.params;
  try {
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
        .populate('occupiedBy', 'tenantName tenantEmail tenantType entryDate')
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
          effectiveOrigin,
          isVacant
        );

        const currentService = getCurrentRent(
          unit.baseServiceCharge2024 || unit.serviceChargeMonthly,
          unit.lastServiceIncreaseDate || unit.createdAt || new Date('2024-01-01'),
          isVacant
        );
        const { isOneTimeFeeApplicable } = require('../utils/rentCalculator');
        const isFeeApplicable = !unit.occupiedBy || (isOneTimeFeeApplicable(unit.occupiedBy.entryDate) && unit.occupiedBy.tenantType === 'new');
        return {
          unitId: unit._id,
          label: unit.label,
          monthlyPrice: unit.monthlyPrice,
          currentEffectivePrice: currentPrice,
          isRentIncreased: currentPrice > (unit.basePrice2024 || unit.monthlyPrice),
          serviceChargeMonthly: unit.serviceChargeMonthly,
          currentEffectiveService: currentService,
          isServiceIncreased: currentService > (unit.baseServiceCharge2024 || unit.serviceChargeMonthly),
          currentEffectiveCaution: isFeeApplicable ? getCurrentRent(
            unit.baseCaution2024 || unit.cautionFee || 0,
            unit.lastCautionIncreaseDate || unit.createdAt || new Date('2024-01-01'),
            isVacant
          ) : 0,
          currentEffectiveLegal: isFeeApplicable ? getCurrentRent(
            unit.baseLegal2024 || unit.legalFee || 0,
            unit.lastLegalIncreaseDate || unit.createdAt || new Date('2024-01-01'),
            isVacant
          ) : 0,
          meterNumber: unit.meterNumber,
          description: unit.description,
          cautionFee: isFeeApplicable ? getCurrentRent(
            unit.baseCaution2024 || unit.cautionFee || 0,
            unit.lastCautionIncreaseDate || unit.createdAt || new Date('2024-01-01'),
            isVacant
          ) : 0,
          legalFee: isFeeApplicable ? getCurrentRent(
            unit.baseLegal2024 || unit.legalFee || 0,
            unit.lastLegalIncreaseDate || unit.createdAt || new Date('2024-01-01'),
            isVacant
          ) : 0,
          status: unit.status,
          category: unit.category,
          listingType: unit.listingType,
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
  const { estateId } = req.params;
  try {

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
          currentEffectiveCaution: getCurrentRent(
            unit.baseCaution2024 || unit.cautionFee || 0,
            unit.lastCautionIncreaseDate || unit.createdAt || new Date('2024-01-01'),
            true
          ),
          currentEffectiveLegal: getCurrentRent(
            unit.baseLegal2024 || unit.legalFee || 0,
            unit.lastLegalIncreaseDate || unit.createdAt || new Date('2024-01-01'),
            true
          ),
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
    const unit = await Unit.findById(unitId)
      .populate('estate', 'name')
      .populate('occupiedBy', 'tenantName tenantEmail tenantType entryDate');
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
    const { isOneTimeFeeApplicable } = require('../utils/rentCalculator');
    const isFeeApplicable = !unit.occupiedBy || (isOneTimeFeeApplicable(unit.occupiedBy.entryDate) && unit.occupiedBy.tenantType === 'new');
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
        currentEffectiveCaution: isFeeApplicable ? getCurrentRent(
          unit.baseCaution2024 || unit.cautionFee || 0,
          unit.lastCautionIncreaseDate || unit.createdAt || new Date('2024-01-01'),
          isVacant
        ) : 0,
        currentEffectiveLegal: isFeeApplicable ? getCurrentRent(
          unit.baseLegal2024 || unit.legalFee || 0,
          unit.lastLegalIncreaseDate || unit.createdAt || new Date('2024-01-01'),
          isVacant
        ) : 0,
        meterNumber: unit.meterNumber,
        description: unit.description,
        serviceChargeMonthly: unit.serviceChargeMonthly,
        cautionFee: isFeeApplicable ? getCurrentRent(
          unit.baseCaution2024 || unit.cautionFee || 0,
          unit.lastCautionIncreaseDate || unit.createdAt || new Date('2024-01-01'),
          isVacant
        ) : 0,
        legalFee: isFeeApplicable ? getCurrentRent(
          unit.baseLegal2024 || unit.legalFee || 0,
          unit.lastLegalIncreaseDate || unit.createdAt || new Date('2024-01-01'),
          isVacant
        ) : 0,
        status: unit.status,
        category: unit.category,
        listingType: unit.listingType,
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

    console.log('DIAGNOSTIC - updateUnit Incoming:', {
      unitId,
      body: req.body,
      parsed: { mp, sc, cf, lf }
    });

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

    // CASCADE 26% increase if unit is vacant and prices change
    if (unit.status === 'vacant' && (mp != null || sc != null || cf != null || lf != null)) {
      const INCREASE_RATE = 1.26;

      // If rent changed, and other fields didn't, apply 26% to others
      // If any field changed, we treat it as a "price refresh" for the vacant unit
      if (mp == null) unit.monthlyPrice = Math.round(unit.monthlyPrice * INCREASE_RATE);
      if (sc == null) unit.serviceChargeMonthly = Math.round((unit.serviceChargeMonthly || 0) * INCREASE_RATE);
      if (cf == null) unit.cautionFee = Math.round((unit.cautionFee || 0) * INCREASE_RATE);
      if (lf == null) unit.legalFee = Math.round((unit.legalFee || 0) * INCREASE_RATE);

      // System rule: resetting the base after a manual/cascade increase
      unit.basePrice2024 = unit.monthlyPrice;
      unit.lastRentIncreaseDate = new Date();
      unit.baseServiceCharge2024 = unit.serviceChargeMonthly;
      unit.lastServiceIncreaseDate = new Date();
      unit.baseCaution2024 = unit.cautionFee;
      unit.lastCautionIncreaseDate = new Date();
      unit.baseLegal2024 = unit.legalFee;
      unit.lastLegalIncreaseDate = new Date();

      logInfo(`Applied 26% cascade increase to vacant unit ${unitId}`);
    } else {
      // Normal application of values if provided
      if (mp != null) {
        unit.monthlyPrice = mp;
        unit.basePrice2024 = mp;
        unit.lastRentIncreaseDate = new Date();
      }
      if (sc != null) {
        unit.serviceChargeMonthly = sc;
        unit.baseServiceCharge2024 = sc;
        unit.lastServiceIncreaseDate = new Date();
      }
      if (cf != null) {
        unit.cautionFee = cf;
        unit.baseCaution2024 = cf;
        unit.lastCautionIncreaseDate = new Date();
      }
      if (lf != null) {
        unit.legalFee = lf;
        unit.baseLegal2024 = lf;
        unit.lastLegalIncreaseDate = new Date();
      }
    }

    if (meterNumber !== undefined) unit.meterNumber = meterNumber;
    if (description !== undefined) unit.description = description;
    if (features !== undefined) unit.features = features;
    if (status !== undefined) unit.status = status;
    if (category !== undefined) unit.category = category;
    if (listingType !== undefined) unit.listingType = listingType;
    if (availableDate !== undefined) unit.availableDate = availableDate;
    if (bedrooms !== undefined) unit.bedrooms = bedrooms;
    if (bathrooms !== undefined) unit.bathrooms = bathrooms;
    if (area !== undefined) unit.area = area;
    if (amenities !== undefined) unit.amenities = amenities;
    if (streetAddress !== undefined) unit.streetAddress = streetAddress;
    if (images !== undefined) {
      unit.images = Array.isArray(images) ? images.map(img =>
        typeof img === 'string'
          ? { url: img }
          : { url: img.url || img.secure_url, publicId: img.publicId || img.public_id || undefined, caption: img.caption || undefined }
      ).filter(img => img.url) : [];
    }

    unit.updatedBy = req.user?._id;
    await unit.save();

    // Keep active tenants in this unit in sync with the unit's updated prices.
    // IMPORTANT: must sync baseRent2024 + lastRentIncreaseDate (not just rentAmount)
    // otherwise getTenant's getCurrentRent() still uses the old base and applies 26% on top.
    const tenantSync = {};
    if (mp != null) {
      tenantSync.rentAmount = mp;
      tenantSync.baseRent2024 = mp;               // Reset base so 26% calculates from new price
      tenantSync.lastRentIncreaseDate = new Date(); // Reset origin date
    }
    if (sc != null) {
      tenantSync.serviceChargeAmount = sc;
      tenantSync.baseServiceCharge2024 = sc;
      tenantSync.lastServiceIncreaseDate = new Date();
    }
    if (cf != null) {
      tenantSync.baseCaution2024 = cf;
      tenantSync.lastCautionIncreaseDate = new Date();
    }
    if (lf != null) {
      tenantSync.baseLegal2024 = lf;
      tenantSync.lastLegalIncreaseDate = new Date();
    }
    if (Object.keys(tenantSync).length > 0) {
      tenantSync.updatedBy = req.user?._id;

      // Build a history entry record
      const historyEntry = {
        event: 'note',
        note: 'Unit fees updated, tenant synced automatically',
        meta: { ...tenantSync },
        createdBy: req.user?._id,
        createdAt: new Date()
      };

      await Tenant.updateMany(
        { unit: unit._id, isActive: true },
        {
          $set: tenantSync,
          $push: { history: historyEntry }
        }
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

/**
 * POST /api/units/unit/:unitId/media/images
 * Upload one or more images (multipart) to Cloudinary and attach to unit.
 * Field name: "images" (up to 10 files)
 */
const uploadUnitImages = async (req, res) => {
  try {
    ensureCloudinaryConfigured();

    const { unitId } = req.params;
    const unit = await Unit.findById(unitId);
    if (!unit || !unit.isActive) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }

    if (!req.files || req.files.length === 0) {
      return res.status(400).json({ success: false, message: 'No image files uploaded' });
    }

    const folder = `${process.env.CLOUDINARY_FOLDER || 'bamihustle'}/units/${unitId}/images`;
    const uploaded = [];

    for (const file of req.files) {
      const result = await uploadBufferToCloudinary(file.buffer, {
        folder,
        resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }]
      });
      uploaded.push({ url: result.secure_url, publicId: result.public_id });
    }

    unit.images.push(...uploaded);
    unit.updatedBy = req.user._id;
    await unit.save();

    return res.status(200).json({
      success: true,
      message: `${uploaded.length} image(s) uploaded and attached to unit`,
      uploaded,
      images: unit.images
    });
  } catch (err) {
    logError('uploadUnitImages error', err);
    return res.status(err.http_code || 500).json({ success: false, message: err.message || 'Image upload failed' });
  }
};

/**
 * POST /api/units/unit/:unitId/media/videos
 * Upload a single video (multipart) to Cloudinary and attach to unit.
 * Field name: "video"
 */
const uploadUnitVideo = async (req, res) => {
  try {
    ensureCloudinaryConfigured();

    const { unitId } = req.params;
    const unit = await Unit.findById(unitId);
    if (!unit || !unit.isActive) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, message: 'No video file uploaded' });
    }

    const folder = `${process.env.CLOUDINARY_FOLDER || 'bamihustle'}/units/${unitId}/videos`;
    const result = await uploadBufferToCloudinary(req.file.buffer, {
      folder,
      resource_type: 'video',
      eager: [{ format: 'jpg', transformation: [{ start_offset: '0' }] }] // auto-generate thumbnail
    });

    const thumbnail = result.eager?.[0]?.secure_url || null;
    const entry = { url: result.secure_url, publicId: result.public_id, thumbnail };

    unit.videos.push(entry);
    unit.updatedBy = req.user._id;
    await unit.save();

    return res.status(200).json({
      success: true,
      message: 'Video uploaded and attached to unit',
      video: entry,
      videos: unit.videos
    });
  } catch (err) {
    logError('uploadUnitVideo error', err);
    return res.status(err.http_code || 500).json({ success: false, message: err.message || 'Video upload failed' });
  }
};

/**
 * PATCH /api/units/unit/:unitId/media
 * Update unit media from JSON — use after uploading files via /api/upload/image or /api/upload/video.
 * Body: { images: [{url, publicId, caption}], videos: [{url, publicId, thumbnail, caption}], replace: true/false }
 * replace=true  → replaces all existing media
 * replace=false → appends to existing media (default)
 */
const updateUnitMedia = async (req, res) => {
  try {
    const { unitId } = req.params;
    const { images, videos, replace = false } = req.body;

    const unit = await Unit.findById(unitId);
    if (!unit || !unit.isActive) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }

    if (!images && !videos) {
      return res.status(400).json({ success: false, message: 'Provide at least images or videos in the request body' });
    }

    if (images !== undefined) {
      if (!Array.isArray(images)) {
        return res.status(400).json({ success: false, message: 'images must be an array' });
      }
      const mapped = images.map(img => ({
        url: img.url || img.secure_url,
        publicId: img.publicId || img.public_id || null,
        caption: img.caption || null
      })).filter(img => img.url);

      unit.images = replace ? mapped : [...unit.images, ...mapped];
    }

    if (videos !== undefined) {
      if (!Array.isArray(videos)) {
        return res.status(400).json({ success: false, message: 'videos must be an array' });
      }
      const mapped = videos.map(vid => ({
        url: vid.url || vid.secure_url,
        publicId: vid.publicId || vid.public_id || null,
        thumbnail: vid.thumbnail || null,
        caption: vid.caption || null
      })).filter(vid => vid.url);

      unit.videos = replace ? mapped : [...unit.videos, ...mapped];
    }

    unit.updatedBy = req.user._id;
    await unit.save();

    return res.status(200).json({
      success: true,
      message: 'Unit media updated',
      images: unit.images,
      videos: unit.videos
    });
  } catch (err) {
    logError('updateUnitMedia error', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to update unit media' });
  }
};

/**
 * DELETE /api/units/unit/:unitId/media
 * Remove specific images or videos from a unit (and from Cloudinary if publicId is stored).
 * Body: { imageIds: ['publicId1', ...], videoIds: ['publicId1', ...] }
 */
const removeUnitMedia = async (req, res) => {
  try {
    ensureCloudinaryConfigured();

    const { unitId } = req.params;
    const { imageIds = [], videoIds = [] } = req.body;

    const unit = await Unit.findById(unitId);
    if (!unit || !unit.isActive) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }

    // Delete from Cloudinary and remove from unit
    for (const publicId of imageIds) {
      try { await cloudinary.uploader.destroy(publicId, { resource_type: 'image' }); } catch (_) {}
      unit.images = unit.images.filter(img => img.publicId !== publicId);
    }
    for (const publicId of videoIds) {
      try { await cloudinary.uploader.destroy(publicId, { resource_type: 'video' }); } catch (_) {}
      unit.videos = unit.videos.filter(vid => vid.publicId !== publicId);
    }

    unit.updatedBy = req.user._id;
    await unit.save();

    return res.status(200).json({
      success: true,
      message: 'Media removed',
      images: unit.images,
      videos: unit.videos
    });
  } catch (err) {
    logError('removeUnitMedia error', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to remove media' });
  }
};

// ─── Condition Report Functions ───────────────────────────────────────────────

/**
 * POST /api/units/unit/:unitId/condition
 * Create a new condition report with files uploaded directly (multipart).
 * Fields: "images" (up to 20), "video" (optional, 1 file)
 * Body fields: type, overallCondition, notes, tenantId, date, caption[]
 */
const createConditionReport = async (req, res) => {
  try {
    ensureCloudinaryConfigured();

    const { unitId } = req.params;
    const { type, overallCondition, notes, tenantId, date } = req.body;

    if (!type) {
      return res.status(400).json({ success: false, message: 'Condition report type is required (move_in, move_out, routine, maintenance, pre_listing)' });
    }

    const unit = await Unit.findById(unitId);
    if (!unit || !unit.isActive) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }

    const imageFolder = `${process.env.CLOUDINARY_FOLDER || 'bamihustle'}/units/${unitId}/condition/images`;
    const videoFolder = `${process.env.CLOUDINARY_FOLDER || 'bamihustle'}/units/${unitId}/condition/videos`;

    const imageFiles = req.files?.images || [];
    const videoFile = req.files?.video?.[0] || null;

    const IMAGE_MAX = 10 * 1024 * 1024;
    const oversized = imageFiles.find(f => f.size > IMAGE_MAX);
    if (oversized) {
      return res.status(400).json({ success: false, message: `Image "${oversized.originalname}" exceeds the 10MB limit` });
    }

    // Upload images
    const uploadedImages = [];
    for (const file of imageFiles) {
      const result = await uploadBufferToCloudinary(file.buffer, {
        folder: imageFolder,
        resource_type: 'image',
        transformation: [{ quality: 'auto', fetch_format: 'auto' }]
      });
      uploadedImages.push({ url: result.secure_url, publicId: result.public_id, caption: file.originalname || null });
    }

    // Upload video if provided
    const uploadedVideos = [];
    if (videoFile) {
      const result = await uploadBufferToCloudinary(videoFile.buffer, {
        folder: videoFolder,
        resource_type: 'video',
        eager: [{ format: 'jpg', transformation: [{ start_offset: '0' }] }]
      });
      uploadedVideos.push({
        url: result.secure_url,
        publicId: result.public_id,
        thumbnail: result.eager?.[0]?.secure_url || null
      });
    }

    const report = {
      type,
      overallCondition: overallCondition || 'good',
      notes: notes || null,
      date: date ? new Date(date) : new Date(),
      images: uploadedImages,
      videos: uploadedVideos,
      tenant: tenantId || null,
      recordedBy: req.user._id
    };

    unit.conditionReports.push(report);
    unit.updatedBy = req.user._id;
    await unit.save();

    const saved = unit.conditionReports[unit.conditionReports.length - 1];

    return res.status(201).json({
      success: true,
      message: 'Condition report created',
      conditionReport: saved
    });
  } catch (err) {
    logError('createConditionReport error', err);
    return res.status(err.http_code || 500).json({ success: false, message: err.message || 'Failed to create condition report' });
  }
};

/**
 * POST /api/units/unit/:unitId/condition/json
 * Create a condition report from JSON (Cloudinary URLs already obtained separately).
 * Body: { type, overallCondition, notes, tenantId, date, images: [{url, publicId, caption}], videos: [{url, publicId, thumbnail}] }
 */
const createConditionReportFromJson = async (req, res) => {
  try {
    const { unitId } = req.params;
    const { type, overallCondition, notes, tenantId, date, images = [], videos = [] } = req.body;

    if (!type) {
      return res.status(400).json({ success: false, message: 'Condition report type is required (move_in, move_out, routine, maintenance, pre_listing)' });
    }

    const unit = await Unit.findById(unitId);
    if (!unit || !unit.isActive) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }

    const mappedImages = images.map(img => ({
      url: img.url || img.secure_url,
      publicId: img.publicId || img.public_id || null,
      caption: img.caption || null
    })).filter(i => i.url);

    const mappedVideos = videos.map(vid => ({
      url: vid.url || vid.secure_url,
      publicId: vid.publicId || vid.public_id || null,
      thumbnail: vid.thumbnail || null,
      caption: vid.caption || null
    })).filter(v => v.url);

    const report = {
      type,
      overallCondition: overallCondition || 'good',
      notes: notes || null,
      date: date ? new Date(date) : new Date(),
      images: mappedImages,
      videos: mappedVideos,
      tenant: tenantId || null,
      recordedBy: req.user._id
    };

    unit.conditionReports.push(report);
    unit.updatedBy = req.user._id;
    await unit.save();

    const saved = unit.conditionReports[unit.conditionReports.length - 1];

    return res.status(201).json({
      success: true,
      message: 'Condition report created',
      conditionReport: saved
    });
  } catch (err) {
    logError('createConditionReportFromJson error', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to create condition report' });
  }
};

/**
 * GET /api/units/unit/:unitId/condition
 * Get all condition reports for a unit, newest first.
 * Query: type (filter by move_in|move_out|routine|maintenance|pre_listing)
 */
const getConditionReports = async (req, res) => {
  try {
    const { unitId } = req.params;
    const { type } = req.query;

    const unit = await Unit.findById(unitId)
      .populate('conditionReports.recordedBy', 'name email')
      .populate('conditionReports.tenant', 'tenantName unitLabel')
      .lean();

    if (!unit || !unit.isActive) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }

    let reports = (unit.conditionReports || []).sort((a, b) => new Date(b.date) - new Date(a.date));
    if (type) reports = reports.filter(r => r.type === type);

    return res.status(200).json({
      success: true,
      unit: { id: unit._id, label: unit.label, status: unit.status },
      count: reports.length,
      conditionReports: reports
    });
  } catch (err) {
    logError('getConditionReports error', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to fetch condition reports' });
  }
};

/**
 * DELETE /api/units/unit/:unitId/condition/:reportId
 * Delete a specific condition report and its Cloudinary assets.
 */
const deleteConditionReport = async (req, res) => {
  try {
    ensureCloudinaryConfigured();

    const { unitId, reportId } = req.params;
    const unit = await Unit.findById(unitId);
    if (!unit || !unit.isActive) {
      return res.status(404).json({ success: false, message: 'Unit not found' });
    }

    const report = unit.conditionReports.id(reportId);
    if (!report) {
      return res.status(404).json({ success: false, message: 'Condition report not found' });
    }

    // Delete assets from Cloudinary
    for (const img of report.images) {
      if (img.publicId) {
        try { await cloudinary.uploader.destroy(img.publicId, { resource_type: 'image' }); } catch (_) {}
      }
    }
    for (const vid of report.videos) {
      if (vid.publicId) {
        try { await cloudinary.uploader.destroy(vid.publicId, { resource_type: 'video' }); } catch (_) {}
      }
    }

    report.deleteOne();
    unit.updatedBy = req.user._id;
    await unit.save();

    return res.status(200).json({ success: true, message: 'Condition report deleted' });
  } catch (err) {
    logError('deleteConditionReport error', err);
    return res.status(500).json({ success: false, message: err.message || 'Failed to delete condition report' });
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
  uploadUnitImages,
  uploadUnitVideo,
  updateUnitMedia,
  removeUnitMedia,
  createConditionReport,
  createConditionReportFromJson,
  getConditionReports,
  deleteConditionReport,
};
