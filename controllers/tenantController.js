const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const Unit = require('../models/Unit');
const Transaction = require('../models/Transaction');
const Payment = require('../models/Payment');
const BillingItem = require('../models/BillingItem');
const User = require('../models/User');
const crypto = require('crypto');
const { sendTenantWelcomeEmail } = require('../utils/emailService');
const { validationResult } = require('express-validator');
const { logError, logInfo, logWarning } = require('../utils/logger');
const { sendActivityToSlack } = require('../utils/slackService');

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

    // Enforce 1-year contract for new tenants
    let durationMonths = req.body?.durationMonths != null
      ? parseInt(req.body.durationMonths, 10)
      : undefined;

    const isNewTenant = !tenantType || tenantType === 'new';

    if (isNewTenant) {
      if (durationMonths === undefined) {
        durationMonths = 12; // Auto-set to 1 year for new tenants
      } else if (durationMonths < 12) {
        return res.status(400).json({
          success: false,
          message: 'All new apartments must be on a 1-year contract. Minimum 12 months payment required.'
        });
      }
    } else {
      // For existing/old tenants, we still want a valid duration if provided
      if (durationMonths !== undefined && durationMonths < 6) {
        return res.status(400).json({ success: false, message: 'Minimum 6 months payment required for renewals.' });
      }
    }

    if (durationMonths !== undefined && durationMonths > 12) {
      return res.status(400).json({
        success: false,
        message: 'The system does not accept payments for more than 12 months (1 year).'
      });
    }

    let effectiveNextDueDate = parsedNextDueDate;
    if (Number.isInteger(durationMonths) && durationMonths > 0) {
      const baseDate = parsedEntryDate || new Date();
      const due = new Date(baseDate.getTime());
      // Add N months while letting JS handle year rollover
      due.setMonth(due.getMonth() + durationMonths);
      effectiveNextDueDate = due;
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
          role: 'tenant',
          createdBy: req.user?._id,
          emailVerified: true
        });
        userId = newUser._id;
      }
    }

    // Ensure only one active tenant per unitLabel in an estate by
    // deactivating any existing active tenants for this flat.
    await Tenant.updateMany(
      { estate: estateId, unitLabel: unit.label, isActive: true },
      { $set: { isActive: false, status: 'vacant', updatedBy: req.user?._id } }
    );

    // Automated Rent Increase Logic initialization
    const { RULE_START_DATE } = require('../utils/rentCalculator');
    const startForIncrease = parsedEntryDate > RULE_START_DATE ? parsedEntryDate : RULE_START_DATE;

    const tenant = await Tenant.create({
      estate: estateId,
      unit: unitId,
      unitLabel: unit.label,
      tenantName: fullName,
      tenantEmail: emailAddr || undefined,
      tenantPhone: phone || undefined,
      rentAmount: unit.monthlyPrice,
      baseRent2024: unit.monthlyPrice,
      lastRentIncreaseDate: startForIncrease,
      serviceChargeAmount: unit.serviceChargeMonthly || 0, // Initial service charge
      baseServiceCharge2024: unit.serviceChargeMonthly || 0,
      lastServiceIncreaseDate: startForIncrease,
      tenantType,
      electricMeterNumber: unit.meterNumber,
      entryDate: parsedEntryDate || new Date(),
      nextDueDate: effectiveNextDueDate,
      status: 'occupied',
      user: userId,
      // Global 26% increase rule fields
      baseCaution2024: unit.baseCaution2024 || unit.cautionFee || 0,
      lastCautionIncreaseDate: unit.lastCautionIncreaseDate || startForIncrease,
      baseLegal2024: unit.baseLegal2024 || unit.legalFee || 0,
      lastLegalIncreaseDate: unit.lastLegalIncreaseDate || startForIncrease,
      history: [{ event: 'created', note: 'Tenant record created', meta: { unitId, unitLabel: unit.label, rentAmount: unit.monthlyPrice, serviceCharge: unit.serviceChargeMonthly }, createdBy: req.user?._id }],
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

    sendActivityToSlack('New Tenant Move-In', {
      tenant: tenant.tenantName,
      unit: unit.label,
      estate: estate.name,
      rent: `₦${tenant.rentAmount.toLocaleString()}`,
      createdBy: req.user?.name || req.user?.email || 'System'
    }, '#36a64f', '🏠');

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
    const { page = 1, limit = 20, search, view, year: yearParam } = req.query;

    // Prioritize quarter from params (structural info) then query
    const quarter = req.params.quarter || req.query.quarter;

    const filter = { isActive: true };
    if (estateId) {
      const mongoose = require('mongoose');
      filter.estate = new mongoose.Types.ObjectId(estateId);
    }
    if (search) filter.$or = [
      { tenantName: new RegExp(search, 'i') },
      { tenantEmail: new RegExp(search, 'i') },
      { tenantPhone: new RegExp(search, 'i') },
    ];

    const requestedQuarter = quarter ? quarter.toUpperCase() : null;
    const isExtendedPeriod = requestedQuarter === '6_MONTHS';
    const isValidQuarter = ['Q1', 'Q2', 'Q3', 'Q4'].includes(requestedQuarter);
    const isQuarterlyView = view === 'quarterly' || (isValidQuarter && !isExtendedPeriod);

    // Date range filtering (Year/Quarter/Extended Period)
    const year = yearParam ? parseInt(yearParam, 10) : null;
    if (year || isValidQuarter || isQuarterlyView || isExtendedPeriod) {
      const now = new Date();
      const targetYear = year || now.getFullYear();
      let startDate, endDate;

      if (requestedQuarter === '6_MONTHS') {
        startDate = now;
        endDate = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
      } else if (isValidQuarter) {
        const qIndex = parseInt(requestedQuarter.substring(1)) - 1;
        startDate = new Date(targetYear, qIndex * 3, 1);
        endDate = new Date(targetYear, (qIndex + 1) * 3, 1);
      } else {
        startDate = new Date(targetYear, 0, 1);
        endDate = new Date(targetYear + 1, 0, 1);
      }

      filter.nextDueDate = { $gte: startDate, $lt: endDate };
      filter.status = { $in: ['occupied', 'pending'] };
    }

    const { getCurrentRent } = require('../utils/rentCalculator');

    // Helper to process tenant and add fees/metadata
    const processTenant = (tenant) => {
      const currentPrice = getCurrentRent(
        tenant.baseRent2024 || tenant.rentAmount,
        tenant.lastRentIncreaseDate || tenant.entryDate || tenant.createdAt,
        false // Occupied
      );

      const currentService = getCurrentRent(
        tenant.baseServiceCharge2024 || tenant.serviceChargeAmount || tenant.unit?.serviceChargeMonthly || 0,
        tenant.lastServiceIncreaseDate || tenant.entryDate || tenant.createdAt,
        false // Occupied
      );

      const currentCaution = getCurrentRent(
        tenant.baseCaution2024 || 0,
        tenant.lastCautionIncreaseDate || tenant.entryDate || tenant.createdAt,
        false // Occupied
      );

      const currentLegal = getCurrentRent(
        tenant.baseLegal2024 || 0,
        tenant.lastLegalIncreaseDate || tenant.entryDate || tenant.createdAt,
        false // Occupied
      );

      const totalMonthlyFees = currentPrice + currentService;

      const dueDate = new Date(tenant.nextDueDate);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const diffTime = dueDate - today;
      const daysUntilDue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

      let statusColor = '#4caf50'; // Green (Safe)
      if (daysUntilDue < 0) {
        statusColor = '#ff0000'; // Red (Overdue)
      } else if (daysUntilDue <= 7) {
        statusColor = '#ff9800'; // Orange (Due Soon)
      }

      return {
        ...tenant,
        currentEffectiveRent: currentPrice,
        isRentIncreased: currentPrice > (tenant.baseRent2024 || tenant.rentAmount),
        currentEffectiveService: currentService,
        isServiceIncreased: currentService > (tenant.baseServiceCharge2024 || tenant.serviceChargeAmount || tenant.unit?.serviceChargeMonthly || 0),
        currentEffectiveCaution: currentCaution,
        isCautionIncreased: currentCaution > (tenant.baseCaution2024 || 0),
        currentEffectiveLegal: currentLegal,
        isLegalIncreased: currentLegal > (tenant.baseLegal2024 || 0),
        totalMonthlyFees,
        daysUntilDue,
        statusColor,
        unitReference: tenant.unitLabel || (tenant.unit?.label || 'N/A')
      };
    };

    if (isQuarterlyView || isValidQuarter) {
      const tenants = await Tenant.find(filter)
        .select('tenantName tenantEmail tenantPhone rentAmount serviceChargeAmount nextDueDate status unitLabel baseRent2024 lastRentIncreaseDate entryDate createdAt baseServiceCharge2024 lastServiceIncreaseDate')
        .populate('unit', 'label serviceChargeMonthly')
        .sort({ nextDueDate: 1 })
        .lean();

      const quarters = {
        Q1: { Jan: [], Feb: [], Mar: [] },
        Q2: { Apr: [], May: [], Jun: [] },
        Q3: { Jul: [], Aug: [], Sep: [] },
        Q4: { Oct: [], Nov: [], Dec: [] },
      };

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      let totalMonthlyRent = 0;

      tenants.forEach(tenant => {
        const processed = processTenant(tenant);
        const date = new Date(tenant.nextDueDate);
        const monthIndex = date.getMonth();
        const monthName = monthNames[monthIndex];
        const quarterNum = Math.floor(monthIndex / 3) + 1;
        const qKey = `Q${quarterNum}`;

        if (quarters[qKey] && quarters[qKey][monthName]) {
          quarters[qKey][monthName].push(processed);
          totalMonthlyRent += processed.totalMonthlyFees;
        }
      });

      const responseData = isValidQuarter ? quarters[requestedQuarter] : quarters;

      return res.status(200).json({
        success: true,
        data: responseData,
        meta: {
          year: year || new Date().getFullYear(),
          quarter: requestedQuarter || 'ALL',
          estateId: estateId || null,
          view: isValidQuarter ? 'single_quarter' : 'quarterly'
        },
        summary: {
          tenantCount: tenants.length,
          totalMonthlyRent,
          total6MonthsRent: totalMonthlyRent * 6,
          totalYearlyRent: totalMonthlyRent * 12,
          currency: 'NGN'
        }
      });
    }

    // Default: Paginated list
    const skip = (parseInt(page) - 1) * parseInt(limit);

    // Add summary calculation for the flat list
    const [items, total, stats] = await Promise.all([
      Tenant.find(filter)
        .select('tenantName tenantEmail tenantPhone rentAmount serviceChargeAmount nextDueDate status tenantType unitLabel createdAt baseRent2024 lastRentIncreaseDate entryDate baseServiceCharge2024 lastServiceIncreaseDate')
        .populate('estate', 'name')
        .populate('unit', 'label monthlyPrice serviceChargeMonthly')
        .sort({ nextDueDate: 1, createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .lean(),
      Tenant.countDocuments(filter),
      Tenant.aggregate([
        { $match: filter },
        {
          $group: {
            _id: null,
            totalRent: { $sum: '$rentAmount' },
            totalService: { $sum: '$serviceChargeAmount' },
            count: { $sum: 1 }
          }
        }
      ])
    ]);

    const processedItems = items.map(tenant => processTenant(tenant));
    const summaryData = stats[0] || { totalRent: 0, totalService: 0, count: 0 };
    const totalMonthlyRent = summaryData.totalRent + summaryData.totalService;

    res.status(200).json({
      success: true,
      data: processedItems,
      summary: {
        totalItems: summaryData.count,
        totalMonthlyRent: totalMonthlyRent,
        total6MonthsRent: totalMonthlyRent * 6,
        totalYearlyRent: totalMonthlyRent * 12,
        currency: 'NGN'
      },
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total,
        itemsPerPage: parseInt(limit)
      }
    });
  } catch (err) {
    logError('GET /api/tenants', err, { estateId, page, limit });
    res.status(500).json({ success: false, message: 'Server error occurred while fetching tenants' });
  }
};

// Quarterly rent summary by nextDueDate month (Jan–Mar, Apr–Jun, Jul–Sep, Oct–Dec)


// Get a tenant (supports expand=history,transactions)
const getTenant = async (req, res) => {
  try {
    const { expand, page = 1, limit = 10 } = req.query;
    const includeHistory = expand?.includes('history');
    const includeTx = expand?.includes('transactions');

    console.log('[getTenant] Fetching tenant:', req.params.id, 'with expand:', expand);

    const tenant = await Tenant.findById(req.params.id)
      .populate('estate', 'name')
      .populate('unit', 'label monthlyPrice serviceChargeMonthly cautionFee legalFee');

    console.log('[getTenant] Query result:', tenant ? 'found' : 'not found');

    if (!tenant || !tenant.isActive) {
      console.log('[getTenant] Tenant not found or inactive:', req.params.id);
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    const { getCurrentRent } = require('../utils/rentCalculator');
    const currentCalculatedRent = getCurrentRent(
      tenant.baseRent2024 || tenant.rentAmount,
      tenant.lastRentIncreaseDate || tenant.entryDate || tenant.createdAt,
      false // Occupied
    );

    const currentCalculatedService = getCurrentRent(
      tenant.baseServiceCharge2024 || tenant.serviceChargeAmount || tenant.unit?.serviceChargeMonthly || 0,
      tenant.lastServiceIncreaseDate || tenant.entryDate || tenant.createdAt,
      false // Occupied
    );

    console.log('[getTenant] Tenant found:', tenant._id);

    // Calculate financial summary from payments
    const Payment = require('../models/Payment');
    const paymentAggregation = await Payment.aggregate([
      {
        $match: {
          tenant: new mongoose.Types.ObjectId(tenant._id),
          paymentStatus: 'completed'
        }
      },
      {
        $group: {
          _id: '$paymentType',
          total: { $sum: '$amount' },
          count: { $sum: 1 },
          lastPayment: { $max: '$paymentDate' }
        }
      }
    ]);

    // Process payment breakdown
    const paymentBreakdown = {};
    let totalPaid = 0;
    paymentAggregation.forEach(item => {
      paymentBreakdown[item._id] = {
        total: item.total,
        count: item.count,
        lastPayment: item.lastPayment
      };
      totalPaid += item.total;
    });

    // Get total payments (all statuses for transparency)
    const allPayments = await Payment.countDocuments({ tenant: tenant._id });
    const pendingPayments = await Payment.countDocuments({
      tenant: tenant._id,
      paymentStatus: 'pending'
    });

    // Calculate total duration in months for the entire lease (from move-in to next due date)
    let leaseDurationMonths = 0;
    let totalLeaseAmount = 0;

    if (tenant.entryDate && tenant.nextDueDate) {
      const entryDate = new Date(tenant.entryDate);
      const nextDueDate = new Date(tenant.nextDueDate);

      leaseDurationMonths = (nextDueDate.getFullYear() - entryDate.getFullYear()) * 12 + (nextDueDate.getMonth() - entryDate.getMonth());
      leaseDurationMonths = Math.max(0, leaseDurationMonths); // Avoid negative if dates are weird

      totalLeaseAmount = leaseDurationMonths * (currentCalculatedRent + currentCalculatedService);
    }

    const overview = {
      name: tenant.tenantName,
      unit: tenant.unit ? tenant.unit.label : 'N/A',
      email: tenant.tenantEmail,
      phone: tenant.tenantPhone,

      // Pricing breakdown
      rent: currentCalculatedRent, // Dynamic rent based on rule
      storedRent: tenant.rentAmount, // What is currently in database
      rentIncreased: currentCalculatedRent > (tenant.baseRent2024 || tenant.rentAmount),

      serviceCharge: currentCalculatedService,
      storedServiceCharge: tenant.serviceChargeAmount || (tenant.unit ? tenant.unit.serviceChargeMonthly : 0),
      serviceChargeIncreased: currentCalculatedService > (tenant.baseServiceCharge2024 || tenant.serviceChargeAmount || (tenant.unit ? tenant.unit.serviceChargeMonthly : 0)),

      // Total stay calculation (Rent + Service Charge)
      leaseDurationMonths,
      totalLeaseAmount,

      unitMonthlyPrice: tenant.unit ? tenant.unit.monthlyPrice : null,
      serviceChargeMonthly: tenant.unit ? tenant.unit.serviceChargeMonthly : null,
      cautionFee: tenant.unit ? tenant.unit.cautionFee : null,
      legalFee: tenant.unit ? tenant.unit.legalFee : null,

      nextDue: tenant.nextDueDate,
      meter: tenant.electricMeterNumber,
      type: tenant.tenantType,
      typeBadge: tenant.tenantType === 'new' ? 'New' : tenant.tenantType === 'existing' ? 'Existing' : tenant.tenantType === 'renewal' ? 'Renewal' : 'Transfer',
      status: tenant.status
    };

    // Add financial summary
    const financialSummary = {
      totalPaid,
      totalPayments: allPayments,
      completedPayments: paymentAggregation.reduce((sum, p) => sum + p.count, 0),
      pendingPayments,
      paymentBreakdown: {
        rent: paymentBreakdown.rent || { total: 0, count: 0, lastPayment: null },
        serviceCharge: paymentBreakdown.service_charge || { total: 0, count: 0, lastPayment: null },
        deposit: paymentBreakdown.deposit || { total: 0, count: 0, lastPayment: null },
        cautionFee: paymentBreakdown.caution_fee || { total: 0, count: 0, lastPayment: null },
        legalFee: paymentBreakdown.legal_fee || { total: 0, count: 0, lastPayment: null },
        utilities: paymentBreakdown.utilities || { total: 0, count: 0, lastPayment: null },
        maintenance: paymentBreakdown.maintenance || { total: 0, count: 0, lastPayment: null },
        other: paymentBreakdown.other || { total: 0, count: 0, lastPayment: null }
      }
    };

    const response = {
      success: true,
      data: {
        tenant,
        overview,
        financialSummary
      }
    };

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

    // Rent and unit monthly price are the same concept. If rent is updated here,
    // also update the linked unit's monthlyPrice so they stay in sync.
    let newRentAmount = undefined;
    if (rentAmount !== undefined) {
      newRentAmount = parseInt(rentAmount);
      tenant.rentAmount = newRentAmount;
    }
    if (tenantType !== undefined) tenant.tenantType = tenantType;
    if (electricMeterNumber !== undefined) tenant.electricMeterNumber = electricMeterNumber;

    if (entryDate !== undefined) {
      tenant.entryDate = parseFlexibleDate(entryDate);
    }

    if (nextDueDate !== undefined) {
      tenant.nextDueDate = parseFlexibleDate(nextDueDate);
    }

    if (req.user?.id) tenant.updatedBy = req.user.id;

    // If rent changed and this tenant has a unit, mirror it to the unit.monthlyPrice
    if (newRentAmount != null && tenant.unit) {
      try {
        await Unit.findByIdAndUpdate(tenant.unit, {
          monthlyPrice: newRentAmount,
          updatedBy: req.user?.id,
        });
      } catch (e) {
        logWarning('Failed to sync unit monthlyPrice from tenant rentAmount', {
          tenantId: tenant._id,
          unitId: tenant.unit,
          error: e?.message,
        });
      }
    }

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
          paymentStatus: 'completed',
          isActive: true,
          $or: [
            { paymentType: 'caution_fee' },
            { 'paystackResponse.data.metadata.payment_type': 'initial', 'paystackResponse.data.metadata.billing_items.type': 'caution_fee' },
            { 'paystackResponse.data.metadata.payment_type': 'multiple_billing_items', 'paystackResponse.data.metadata.billing_items.code': 'caution_fee' }
          ]
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
          paymentStatus: 'completed',
          isActive: true,
          $or: [
            { paymentType: 'legal_fee' },
            { 'paystackResponse.data.metadata.payment_type': 'initial', 'paystackResponse.data.metadata.billing_items.type': 'legal_fee' },
            { 'paystackResponse.data.metadata.payment_type': 'multiple_billing_items', 'paystackResponse.data.metadata.billing_items.code': 'legal_fee' }
          ]
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
      try { await cloudinary.uploader.destroy(tenant.profileImagePublicId, { resource_type: 'image' }); } catch (_) { }
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



// List history for the logged-in tenant
async function listMyHistory(req, res) {
  try {
    const tenant = await Tenant.findOne({ user: req.user.id, isActive: true });
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant record not found for this user' });
    }
    const items = (tenant.history || []).slice().reverse();
    return res.status(200).json({ success: true, data: items });
  } catch (err) {
    console.error('List my history error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// @desc    Get all billing items for the logged-in tenant
// @route   GET /api/tenants/me/billing
// @access  Private (Tenant)
async function getMyBillingItems(req, res) {
  try {
    // 1. Fetch direct BillingItems for this user (universal)
    const billingItems = await BillingItem.find({
      user: req.user.id,
      isActive: true,
      isPaid: false
    }).sort({ dueDate: 1 });

    const recurring = [];
    const oneTime = [];
    const optional = [];

    // Categorize direct billing items
    billingItems.forEach(item => {
      const itemData = {
        id: item._id,
        code: item.itemType,
        label: item.label,
        amount: item.amount,
        dueDate: item.dueDate,
        description: item.description,
        type: item.isRecurring ? 'recurring' : 'one_time',
        category: item.category,
        frequency: item.frequency
      };

      if (item.isRecurring) {
        recurring.push(itemData);
      } else if (item.category === 'service') {
        optional.push(itemData);
      } else {
        oneTime.push(itemData);
      }
    });

    // 2. Fallback to Tenant-specific logic if the user is a tenant
    const tenant = await Tenant.findOne({ user: req.user.id, isActive: true })
      .populate('unit', 'label monthlyPrice serviceChargeMonthly cautionFee legalFee');

    if (tenant) {
      const unit = tenant.unit;
      if (unit) {
        const tenantType = tenant.tenantType || 'new';
        const isExistingLike = ['existing', 'renewal', 'transfer'].includes(tenantType);

        // Predefined recurring items (Rent & Service Charge)
        if (tenant.rentAmount > 0) {
          recurring.unshift({
            code: 'rent',
            label: 'Rent',
            amount: tenant.rentAmount,
            dueDate: tenant.nextDueDate,
            type: 'recurring',
            category: 'rent',
            frequency: 'monthly'
          });
        }

        if (unit.serviceChargeMonthly > 0) {
          recurring.push({
            code: 'service_charge',
            label: 'Service Charge',
            amount: unit.serviceChargeMonthly,
            dueDate: tenant.nextDueDate,
            type: 'recurring',
            category: 'service',
            frequency: 'monthly'
          });
        }

        // Predefined one-time items (Fees)
        if (!isExistingLike) {
          if (unit.cautionFee > 0) {
            const paidCaution = await Payment.exists({
              tenant: tenant._id,
              paymentStatus: 'completed',
              isActive: true,
              $or: [
                { paymentType: 'caution_fee' },
                { 'paystackResponse.data.metadata.payment_type': 'initial', 'paystackResponse.data.metadata.billing_items.type': 'caution_fee' },
                { 'paystackResponse.data.metadata.payment_type': 'multiple_billing_items', 'paystackResponse.data.metadata.billing_items.code': 'caution_fee' }
              ]
            });
            if (!paidCaution) {
              oneTime.push({
                code: 'caution_fee',
                label: 'Caution Fee',
                amount: unit.cautionFee,
                type: 'one_time',
                category: 'fees',
                frequency: 'once'
              });
            }
          }

          if (unit.legalFee > 0) {
            const paidLegal = await Payment.exists({
              tenant: tenant._id,
              paymentStatus: 'completed',
              isActive: true,
              $or: [
                { paymentType: 'legal_fee' },
                { 'paystackResponse.data.metadata.payment_type': 'initial', 'paystackResponse.data.metadata.billing_items.type': 'legal_fee' },
                { 'paystackResponse.data.metadata.payment_type': 'multiple_billing_items', 'paystackResponse.data.metadata.billing_items.code': 'legal_fee' }
              ]
            });
            if (!paidLegal) {
              oneTime.push({
                code: 'legal_fee',
                label: 'Legal Fee',
                amount: unit.legalFee,
                type: 'one_time',
                category: 'fees',
                frequency: 'once'
              });
            }
          }
        }
      }
    }

    return res.status(200).json({
      success: true,
      data: {
        recurring,
        oneTime,
        optional
      }
    });
  } catch (err) {
    console.error('Get my billing items error:', err);
    return res.status(500).json({ success: false, message: 'Server error' });
  }
}

// @desc    Pay selected billing items
// @route   POST /api/tenants/me/billing/pay
// @access  Private (Tenant)
async function paySelectedBillingItems(req, res) {
  try {
    const { itemIds } = req.body;

    if (!itemIds || !Array.isArray(itemIds) || itemIds.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select at least one item to pay' });
    }

    const tenant = await Tenant.findOne({ user: req.user.id, isActive: true })
      .populate('estate', 'name')
      .populate('unit', 'label monthlyPrice serviceChargeMonthly cautionFee legalFee');

    // Validate all item IDs and calculate total
    let totalAmount = 0;
    const itemsToProcess = [];

    for (const itemId of itemIds) {
      // 1. Check if it's a BillingItem ID (Works for ALL users)
      if (mongoose.Types.ObjectId.isValid(itemId)) {
        const billingItem = await BillingItem.findOne({
          _id: itemId,
          user: req.user.id, // Match by user ID instead of just tenant
          isActive: true,
          isPaid: false
        });

        if (billingItem) {
          totalAmount += billingItem.amount;
          itemsToProcess.push({
            type: 'billing_item',
            id: billingItem._id,
            code: billingItem.itemType,
            label: billingItem.label,
            amount: billingItem.amount
          });
          continue;
        }
      }

      // 2. Check predefined codes (Only if user has a Tenant record)
      if (tenant) {
        if (itemId === 'rent' && tenant.rentAmount > 0) {
          totalAmount += tenant.rentAmount;
          itemsToProcess.push({
            type: 'predefined',
            code: 'rent',
            label: 'Rent',
            amount: tenant.rentAmount
          });
        } else if (itemId === 'service_charge' && tenant.unit?.serviceChargeMonthly > 0) {
          totalAmount += tenant.unit.serviceChargeMonthly;
          itemsToProcess.push({
            type: 'predefined',
            code: 'service_charge',
            label: 'Service Charge',
            amount: tenant.unit.serviceChargeMonthly
          });
        } else if (itemId === 'caution_fee' && tenant.unit?.cautionFee > 0) {
          const paidCaution = await Payment.exists({
            tenant: tenant._id,
            paymentType: 'caution_fee',
            paymentStatus: 'completed',
            isActive: true,
          });
          if (!paidCaution) {
            totalAmount += tenant.unit.cautionFee;
            itemsToProcess.push({
              type: 'predefined',
              code: 'caution_fee',
              label: 'Caution Fee',
              amount: tenant.unit.cautionFee
            });
          }
        } else if (itemId === 'legal_fee' && tenant.unit?.legalFee > 0) {
          const paidLegal = await Payment.exists({
            tenant: tenant._id,
            paymentType: 'legal_fee',
            paymentStatus: 'completed',
            isActive: true,
          });
          if (!paidLegal) {
            totalAmount += tenant.unit.legalFee;
            itemsToProcess.push({
              type: 'predefined',
              code: 'legal_fee',
              label: 'Legal Fee',
              amount: tenant.unit.legalFee
            });
          }
        }
      }
    }

    if (itemsToProcess.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid billing items found to process' });
    }

    if (totalAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Total amount must be greater than zero' });
    }

    // Initialize Paystack payment
    const paystack = require('../config/paystack');
    const reference = `billing_${req.user.id}_${Date.now()}`;

    const description = itemsToProcess.map(item => item.label).join(', ');

    const metadata = {
      user_id: req.user.id,
      payment_type: 'multiple_billing_items',
      billing_items: itemsToProcess
    };

    if (tenant) {
      metadata.tenant_id = tenant._id.toString();
      metadata.tenant_name = tenant.tenantName;
      metadata.estate_id = tenant.estate?._id.toString();
      metadata.estate_name = tenant.estate?.name;
      metadata.unit_label = tenant.unit?.label;
    }

    const paystackResponse = await paystack.transaction.initialize({
      email: (tenant && tenant.tenantEmail) || req.user.email,
      amount: Math.round(totalAmount * 100), // Convert to kobo
      reference,
      metadata
    });

    if (!paystackResponse.status) {
      return res.status(500).json({ success: false, message: 'Failed to initialize payment' });
    }

    // Create pending payment record
    await Payment.create({
      user: req.user.id,
      tenant: tenant?._id,
      estate: tenant?.estate?._id,
      admin: req.user.id, // For self-paid, admin is the user
      paymentType: 'other',
      amount: totalAmount,
      description,
      paystackReference: reference,
      paystackAccessCode: paystackResponse.data.access_code,
      paymentStatus: 'initiated',
      paymentMethod: 'paystack',
      createdBy: req.user.id
    });

    return res.status(200).json({
      success: true,
      message: 'Payment initialized successfully',
      data: {
        authorizationUrl: paystackResponse.data.authorization_url,
        accessCode: paystackResponse.data.access_code,
        reference,
        amount: totalAmount,
        items: itemsToProcess
      }
    });
  } catch (err) {
    console.error('Pay selected billing items error:', err);
    return res.status(500).json({ success: false, message: 'Server error occurred while processing payment' });
  }
}

// Shift next due date based on payment duration (separate months for rent and service)
const shiftNextDueDate = async (req, res) => {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant || !tenant.isActive) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    const { rentMonths, serviceMonths } = req.body;

    // Validate at least one is provided
    if (!rentMonths && !serviceMonths) {
      return res.status(400).json({
        success: false,
        message: 'Please provide at least one of rentMonths or serviceMonths'
      });
    }

    // Get the current next due date or use today if not set
    const currentDueDate = tenant.nextDueDate ? new Date(tenant.nextDueDate) : new Date();

    // Calculate the new due date using the maximum of the two months
    // This ensures the next due date covers both rent and service periods
    const maxMonths = Math.max(rentMonths || 0, serviceMonths || 0);
    const newDueDate = new Date(currentDueDate);
    newDueDate.setMonth(newDueDate.getMonth() + maxMonths);

    // Store the old date for history
    const oldDueDate = tenant.nextDueDate;

    // Update the tenant's next due date
    tenant.nextDueDate = newDueDate;
    tenant.updatedBy = req.user?.id;

    // Build payment description
    const paymentParts = [];
    if (rentMonths) paymentParts.push(`${rentMonths} month${rentMonths > 1 ? 's' : ''} rent`);
    if (serviceMonths) paymentParts.push(`${serviceMonths} month${serviceMonths > 1 ? 's' : ''} service`);
    const paymentDesc = paymentParts.join(' and ');

    // Create history entry
    const historyEntry = {
      event: 'payment',
      note: `Payment received for ${paymentDesc}. Next due date shifted from ${oldDueDate ? oldDueDate.toISOString().split('T')[0] : 'not set'} to ${newDueDate.toISOString().split('T')[0]}`,
      meta: {
        rentMonths: rentMonths || 0,
        serviceMonths: serviceMonths || 0,
        oldNextDueDate: oldDueDate,
        newNextDueDate: newDueDate
      },
      createdBy: req.user?.id
    };

    // Update tenant using findByIdAndUpdate to avoid full document validation
    // This is necessary because some legacy tenants might not have the required 'unit' field
    await Tenant.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          nextDueDate: newDueDate,
          updatedBy: req.user?.id
        },
        $push: {
          history: historyEntry
        }
      },
      { runValidators: false }
    );

    logInfo('Tenant next due date shifted', {
      tenantId: tenant._id,
      tenantName: tenant.tenantName,
      rentMonths,
      serviceMonths,
      oldDueDate,
      newDueDate
    });

    res.status(200).json({
      success: true,
      message: `Next due date successfully shifted by ${maxMonths} month${maxMonths > 1 ? 's' : ''} (${paymentDesc})`,
      data: {
        tenantId: tenant._id,
        tenantName: tenant.tenantName,
        oldNextDueDate: oldDueDate,
        newNextDueDate: newDueDate,
        rentMonthsPaid: rentMonths || 0,
        serviceMonthsPaid: serviceMonths || 0,
        totalMonthsShifted: maxMonths
      }
    });
  } catch (err) {
    logError('POST /api/tenants/:id/shift-due-date', err, { tenantId: req.params.id });
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }
    res.status(500).json({
      success: false,
      message: 'Server error occurred while shifting next due date'
    });
  }
};

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
  listMyHistory,
  getMyBillingItems,
  paySelectedBillingItems,
  shiftNextDueDate,
};
