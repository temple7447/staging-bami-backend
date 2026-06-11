const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const Unit = require('../models/Unit');
const Transaction = require('../models/Transaction');
const Payment = require('../models/Payment');
const BillingItem = require('../models/BillingItem');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const crypto = require('crypto');
const { sendTenantWelcomeEmail } = require('../utils/emailService');
const { validationResult } = require('express-validator');
const { logError, logInfo, logWarning } = require('../utils/logger');
const { sendActivityToSlack } = require('../utils/slackService');
const { distributePayment } = require('../utils/distributionService');

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
      nextDueDate,
      rentOutstanding,
      serviceChargeOutstanding
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

    // For new tenants nextDueDate = entryDate (rent is due on move-in day).
    // For existing/transfer tenants with no explicit nextDueDate, project the entry date
    // forward by 12-month increments until the next anniversary lands in the future so the
    // yearly breakdown shows upcoming (not historical) periods and the tenant is not
    // immediately flagged as overdue upon onboarding.
    let effectiveNextDueDate;
    if (parsedNextDueDate) {
      effectiveNextDueDate = new Date(Date.UTC(parsedNextDueDate.getUTCFullYear(), parsedNextDueDate.getUTCMonth(), parsedNextDueDate.getUTCDate()));
    } else if (tenantType !== 'new' && parsedEntryDate) {
      const base = new Date(Date.UTC(parsedEntryDate.getUTCFullYear(), parsedEntryDate.getUTCMonth(), parsedEntryDate.getUTCDate()));
      const today = new Date();
      while (base <= today) {
        base.setUTCFullYear(base.getUTCFullYear() + 1);
      }
      effectiveNextDueDate = base;
    } else {
      const _rawDue = parsedEntryDate || new Date();
      effectiveNextDueDate = new Date(Date.UTC(_rawDue.getUTCFullYear(), _rawDue.getUTCMonth(), _rawDue.getUTCDate()));
    }

    // Optionally create or link a user account for tenant
    let userId = undefined;
    let generatedPassword = null;
    if (emailAddr) {
      let existingUser = await User.findOne({ email: emailAddr });
      if (existingUser) {
        // Block if the email belongs to a non-tenant account (admin, manager, etc.)
        if (existingUser.role !== 'tenant') {
          return res.status(400).json({
            success: false,
            message: `This email is already registered as a ${existingUser.role} account and cannot be used for a tenant.`
          });
        }
        userId = existingUser._id;
        // Reactivate if previously deactivated (e.g. tenant was vacated before)
        if (!existingUser.isActive) {
          existingUser.isActive = true;
          await existingUser.save({ validateBeforeSave: false });
        }
        // Generate a fresh temp password and send credentials so they can log in again
        generatedPassword = generateTempPassword(6);
        existingUser.password = generatedPassword;
        await existingUser.save({ validateBeforeSave: false });
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
    const displacedTenants = await Tenant.find(
      { estate: estateId, unitLabel: unit.label, isActive: true },
      { user: 1 }
    ).lean();
    await Tenant.updateMany(
      { estate: estateId, unitLabel: unit.label, isActive: true },
      { $set: { isActive: false, status: 'vacant', updatedBy: req.user?._id } }
    );
    // Also deactivate the login accounts of any displaced tenants so they cannot log in.
    const displacedUserIds = displacedTenants.map(t => t.user).filter(Boolean);
    if (displacedUserIds.length) {
      await User.updateMany({ _id: { $in: displacedUserIds } }, { $set: { isActive: false } });
    }

    const tenant = await Tenant.create({
      estate: estateId,
      unit: unitId,
      unitLabel: unit.label,
      tenantName: fullName,
      tenantEmail: emailAddr || undefined,
      tenantPhone: phone || undefined,
      rentAmount: unit.monthlyPrice,
      baseRent: unit.monthlyPrice,              // Immutable original base — never updated after creation
      serviceChargeAmount: unit.serviceChargeMonthly || 0,
      baseServiceCharge: unit.serviceChargeMonthly || 0, // Immutable original base
      tenantType,
      electricMeterNumber: unit.meterNumber,
      entryDate: parsedEntryDate || new Date(),
      nextDueDate: effectiveNextDueDate,
      status: 'occupied',
      user: userId,
      // Outstanding balances for existing tenants (debt that pre-dates system entry)
      rentOutstanding: (rentOutstanding != null && !isNaN(Number(rentOutstanding))) ? Math.max(0, Number(rentOutstanding)) : 0,
      serviceChargeOutstanding: (serviceChargeOutstanding != null && !isNaN(Number(serviceChargeOutstanding))) ? Math.max(0, Number(serviceChargeOutstanding)) : 0,
      history: [{ event: 'created', note: 'Tenant record created', meta: { unitId, unitLabel: unit.label, rentAmount: unit.monthlyPrice, serviceCharge: unit.serviceChargeMonthly }, createdBy: req.user?._id }],
      createdBy: req.user?._id,
    });

    // Update unit to mark as occupied
    unit.occupiedBy = tenant._id;
    unit.status = 'occupied';
    unit.occupiedSince = parsedEntryDate || new Date();
    unit.updatedBy = req.user?._id;
    await unit.save();

    // Send welcome email with full credentials and tenancy details
    if (emailAddr && generatedPassword) {
      try {
        const userDoc = await User.findById(userId);
        const tenantWallet = await Wallet.findOne({ userId });
        const walletBalance = tenantWallet ? tenantWallet.balance : 0;
        await sendTenantWelcomeEmail(userDoc, generatedPassword, tenant.toObject(), { name: estate.name }, walletBalance);
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
    console.error('DIAGNOSTIC - Tenant creation failed:', {
      errorName: err.name,
      errorCode: err.code,
      errorMessage: err.message,
      body: req.body
    });

    if (err.code === 11000) {
      const message = 'A tenant already exists for this unit in the estate';
      logWarning('Duplicate tenant entry attempted', { unitId, tenantName });
      return res.status(400).json({ success: false, message, detail: err.message });
    }
    if (err.name === 'ValidationError') {
      logWarning('Validation error on tenant creation', { message: err.message });
      return res.status(400).json({ success: false, message: err.message, errors: err.errors });
    }
    res.status(500).json({ success: false, message: 'Server error occurred while creating tenant', error: err.message });
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

      filter.entryDate = { $gte: startDate, $lt: endDate };
    }

    // Helper: returns { caution: Set<tenantId>, legal: Set<tenantId> } of tenants who already paid
    const getPaidFees = async (tenantIds) => {
      if (!tenantIds.length) return { caution: new Set(), legal: new Set() };
      const Payment = require('../models/Payment');
      const paid = await Payment.aggregate([
        {
          $match: {
            tenant: { $in: tenantIds },
            paymentStatus: 'completed',
            paymentType: { $in: ['caution_fee', 'legal_fee'] }
          }
        },
        { $group: { _id: { tenant: '$tenant', type: '$paymentType' } } }
      ]);
      const caution = new Set();
      const legal = new Set();
      for (const p of paid) {
        const id = p._id.tenant.toString();
        if (p._id.type === 'caution_fee') caution.add(id);
        if (p._id.type === 'legal_fee') legal.add(id);
      }
      return { caution, legal };
    };

    // Helper to process tenant and add fees/metadata
    // paidFees: { caution: Set<tenantId string>, legal: Set<tenantId string> }
    const processTenant = (tenant, paidFees = { caution: new Set(), legal: new Set() }) => {
      const { getCurrentRent } = require('../utils/rentCalculator');
      const tenantIdStr = tenant._id?.toString();
      const isApplicable = tenant.tenantType === 'new';
      const cautionAlreadyPaid = paidFees.caution.has(tenantIdStr);
      const legalAlreadyPaid = paidFees.legal.has(tenantIdStr);

      const currentPrice = getCurrentRent(
        tenant.rentAmount,
        tenant.entryDate || tenant.createdAt,
        false // Occupied
      );

      const currentService = getCurrentRent(
        tenant.serviceChargeAmount || tenant.unit?.serviceChargeMonthly || 0,
        tenant.entryDate || tenant.createdAt,
        false // Occupied
      );

      const currentCaution = (isApplicable && !cautionAlreadyPaid) ? getCurrentRent(
        0,
        tenant.entryDate || tenant.createdAt,
        false // Occupied
      ) : 0;

      const currentLegal = (isApplicable && !legalAlreadyPaid) ? getCurrentRent(
        0,
        tenant.entryDate || tenant.createdAt,
        false // Occupied
      ) : 0;

      const totalMonthlyFees = currentPrice + currentService;

      const _today = new Date();
      _today.setHours(0, 0, 0, 0);
      const totalOutstanding = (tenant.rentOutstanding || 0) + (tenant.serviceChargeOutstanding || 0);

      // Resolve effective nextDueDate:
      //   1. If missing entirely → derive from entryDate + 1 year (sensible first-renewal estimate)
      //   2. If before entryDate → data error (bad import), treat same as missing
      //   3. If equals entryDate day+month (legacy onboarding default) AND no outstanding
      //      balance → project forward to next future anniversary
      //   4. Any other past date → genuine overdue, keep it
      const entry = tenant.entryDate ? new Date(tenant.entryDate) : null;
      let projectedDueDate = tenant.nextDueDate ? new Date(tenant.nextDueDate) : null;

      // Case 1 & 2: no nextDueDate or nextDueDate is before entryDate (data error)
      if ((!projectedDueDate || (entry && projectedDueDate < entry)) && entry) {
        projectedDueDate = new Date(Date.UTC(entry.getUTCFullYear() + 1, entry.getUTCMonth(), entry.getUTCDate()));
      }

      // Case 3: legacy onboarding default (day+month matches entryDate, no balance)
      if (projectedDueDate && projectedDueDate < _today && entry) {
        const isLegacyDefault =
          projectedDueDate.getUTCMonth() === entry.getUTCMonth() &&
          projectedDueDate.getUTCDate() === entry.getUTCDate();
        if (isLegacyDefault && totalOutstanding === 0) {
          const anchor = new Date(Date.UTC(entry.getUTCFullYear(), entry.getUTCMonth(), entry.getUTCDate()));
          while (anchor <= _today) {
            anchor.setUTCFullYear(anchor.getUTCFullYear() + 1);
          }
          projectedDueDate = anchor;
        }
        // Case 4: else → genuine overdue, keep the past date
      }

      const diffTime = projectedDueDate ? projectedDueDate - _today : 0;
      const daysUntilDue = projectedDueDate ? Math.ceil(diffTime / (1000 * 60 * 60 * 24)) : null;

      // How many months past due (0 if current)
      const arrearsMonths = daysUntilDue !== null && daysUntilDue < 0
        ? Math.floor(Math.abs(daysUntilDue) / 30) : 0;

      // Status colour rules (Nigerian context):
      //   PURPLE — evicted: in legal dispute, not paying, still in unit
      //   BLUE   — pending: pre-approved, not yet moved in
      //   RED    — occupied + past nextDueDate (genuine overdue / chronic arrears)
      //   ORANGE — occupied + nextDueDate in future BUT has outstanding balance
      //            (partial payment, service charge held, onboarding arrears)
      //   ORANGE — occupied + due within 7 days, no balance (due soon)
      //   GREEN  — occupied, current, no balance
      let statusColor = '#4caf50'; // Green
      if (tenant.status === 'evicted') {
        statusColor = '#9c27b0'; // Purple — legal dispute
      } else if (tenant.status === 'pending') {
        statusColor = '#2196f3'; // Blue — pre-move-in
      } else if (daysUntilDue !== null && daysUntilDue < 0) {
        statusColor = '#ff0000'; // Red — overdue
      } else if (totalOutstanding > 0) {
        statusColor = '#ff9800'; // Orange — has balance
      } else if (daysUntilDue !== null && daysUntilDue <= 7) {
        statusColor = '#ff9800'; // Orange — due soon
      }

      return {
        ...tenant,
        nextDueDate: projectedDueDate || tenant.nextDueDate,
        currentEffectiveRent: currentPrice,
        isRentIncreased: currentPrice > tenant.rentAmount,
        currentEffectiveService: currentService,
        isServiceIncreased: currentService > (tenant.serviceChargeAmount || tenant.unit?.serviceChargeMonthly || 0),
        currentEffectiveCaution: currentCaution,
        isCautionIncreased: false,
        currentEffectiveLegal: currentLegal,
        isLegalIncreased: false,
        totalMonthlyFees,
        totalOutstanding,
        hasOutstanding: totalOutstanding > 0,
        arrearsMonths,
        daysUntilDue,
        statusColor,
        unitReference: tenant.unitLabel || (tenant.unit?.label || 'N/A')
      };
    };

    if (isQuarterlyView || isValidQuarter) {
      const tenants = await Tenant.find(filter)
        .select('tenantName tenantEmail tenantPhone rentAmount serviceChargeAmount nextDueDate status tenantType unitLabel entryDate createdAt rentOutstanding serviceChargeOutstanding')
        .populate('unit', 'label serviceChargeMonthly')
        .sort({ nextDueDate: 1 })
        .lean();

      const tenantIds = tenants.map(t => t._id);
      const paidFees = await getPaidFees(tenantIds);

      const quarters = {
        Q1: { Jan: [], Feb: [], Mar: [] },
        Q2: { Apr: [], May: [], Jun: [] },
        Q3: { Jul: [], Aug: [], Sep: [] },
        Q4: { Oct: [], Nov: [], Dec: [] },
      };

      const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      let totalMonthlyRent = 0;

      tenants.forEach(tenant => {
        const processed = processTenant(tenant, paidFees);
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
        .select('tenantName tenantEmail tenantPhone rentAmount serviceChargeAmount nextDueDate status tenantType unitLabel createdAt entryDate rentOutstanding serviceChargeOutstanding')
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

    const paidFees = await getPaidFees(items.map(t => t._id));
    const processedItems = items.map(tenant => processTenant(tenant, paidFees));
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
  const { expand, page = 1, limit = 10 } = req.query;
  try {
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

    const { getCurrentRent, calculateEffectiveRent } = require('../utils/rentCalculator');
    // Only new tenants owe caution/legal. Renewal/existing tenants already paid these (one-time fees).
    const isApplicable = tenant.tenantType === 'new';

    // Always derive rent from the immutable original base so increase cycles are never
    // compounded. Priority: baseRent field → creation history meta → rentAmount (last resort).
    const creationMeta = tenant.history?.find(h => h.event === 'created')?.meta;
    const rentBase0 = (tenant.baseRent > 0 ? tenant.baseRent : null)
      || (creationMeta?.rentAmount > 0 ? creationMeta.rentAmount : null)
      || tenant.rentAmount;
    const serviceBase0 = (tenant.baseServiceCharge > 0 ? tenant.baseServiceCharge : null)
      || (creationMeta?.serviceCharge > 0 ? creationMeta.serviceCharge : null)
      || tenant.serviceChargeAmount || tenant.unit?.serviceChargeMonthly || 0;

    const currentCalculatedRent = getCurrentRent(
      rentBase0,
      tenant.entryDate || tenant.createdAt,
      false // Occupied
    );

    const currentCalculatedService = getCurrentRent(
      serviceBase0,
      tenant.entryDate || tenant.createdAt,
      false // Occupied
    );

    const currentCalculatedCaution = isApplicable ? getCurrentRent(
      tenant.unit?.cautionFee || 0,
      tenant.entryDate || tenant.createdAt,
      false // Occupied
    ) : 0;

    const currentCalculatedLegal = isApplicable ? getCurrentRent(
      tenant.unit?.legalFee || 0,
      tenant.entryDate || tenant.createdAt,
      false // Occupied
    ) : 0;

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

    // Final check: fees are 0 if payment already exists
    const finalCalculatedCaution = (isApplicable && !(paymentBreakdown.caution_fee?.count > 0)) ? currentCalculatedCaution : 0;
    const finalCalculatedLegal = (isApplicable && !(paymentBreakdown.legal_fee?.count > 0)) ? currentCalculatedLegal : 0;

    // If the dynamic calculation is ahead of stored values, sync them now so the
    // tenant dashboard and admin view always agree without waiting for the scheduler.
    // NOTE: We intentionally do NOT auto-sync tenant.rentAmount or unit.monthlyPrice here.
    // tenant.rentAmount is the ORIGINAL base price at time of onboarding. getCurrentRent()
    // computes the current rate by applying 26% cycles on top of that base from entryDate.
    // Overwriting tenant.rentAmount with the increased rate would cause the next call to
    // compound cycles on an already-increased base, producing a double-increase.
    // The scheduler (or a dedicated admin action) is the right place to persist rent increases.

    // Reconcile nextDueDate from completed rent payments so stale/wrong stored values self-correct.
    const reconciledDueDate = await reconcileNextDueDate(tenant, Payment);
    if (reconciledDueDate) tenant.nextDueDate = reconciledDueDate;

    // Calculate total duration in months for the entire lease (from move-in to next due date)
    let leaseDurationMonths = 0;
    let totalLeaseAmount = 0;

    if (tenant.entryDate && tenant.nextDueDate) {
      const entryDate = new Date(tenant.entryDate);
      const nextDueDate = new Date(tenant.nextDueDate);

      leaseDurationMonths = (nextDueDate.getFullYear() - entryDate.getFullYear()) * 12 + (nextDueDate.getMonth() - entryDate.getMonth());
      leaseDurationMonths = Math.max(0, leaseDurationMonths); // Avoid negative if dates are weird

      totalLeaseAmount = (leaseDurationMonths * (currentCalculatedRent + currentCalculatedService)) + finalCalculatedCaution + finalCalculatedLegal;
    }

    // --- Yearly lease breakdown ---
    const rentOrigin = tenant.entryDate || tenant.createdAt;
    const rentBase = rentBase0;
    const serviceBase = serviceBase0;

    // Anchor to nextDueDate so existing tenants see their actual upcoming renewal period.
    // Only project forward when nextDueDate matches entryDate (day+month) — meaning it was
    // never updated from the onboarding default. If they differ, the tenant had a real payment
    // cycle and a past nextDueDate means they are genuinely overdue; keep the original date so
    // the yearlyBreakdown shows the current (unpaid) period, not a phantom future one.
    let renewalStart = tenant.nextDueDate
      ? new Date(tenant.nextDueDate)
      : (() => { const d = new Date(rentOrigin); d.setFullYear(d.getFullYear() + 1); return d; })();
    const _now = new Date();
    if (renewalStart <= _now) {
      const anchorDate = tenant.entryDate ? new Date(tenant.entryDate) : new Date(rentOrigin);
      const _tenantOutstanding = (tenant.rentOutstanding || 0) + (tenant.serviceChargeOutstanding || 0);
      const isLegacyDefault = tenant.nextDueDate &&
        renewalStart.getUTCMonth() === anchorDate.getUTCMonth() &&
        renewalStart.getUTCDate() === anchorDate.getUTCDate();
      if (!tenant.nextDueDate || (isLegacyDefault && _tenantOutstanding === 0)) {
        renewalStart = new Date(Date.UTC(anchorDate.getUTCFullYear(), anchorDate.getUTCMonth(), anchorDate.getUTCDate()));
        while (renewalStart <= _now) {
          renewalStart.setUTCFullYear(renewalStart.getUTCFullYear() + 1);
        }
      }
      // else: nextDueDate was set by a real payment cycle and is now past → tenant is overdue,
      // keep renewalStart as-is so the yearly breakdown shows the current unpaid period.
    }

    // Recalculate leaseDurationMonths using the projected renewalStart (initial calculation above
    // used raw tenant.nextDueDate which equals entryDate for legacy-default tenants → 0 months).
    if (tenant.entryDate) {
      const _eDate = new Date(tenant.entryDate);
      leaseDurationMonths = (renewalStart.getFullYear() - _eDate.getFullYear()) * 12 + (renewalStart.getMonth() - _eDate.getMonth());
      leaseDurationMonths = Math.max(0, leaseDurationMonths);
      totalLeaseAmount = (leaseDurationMonths * (currentCalculatedRent + currentCalculatedService)) + finalCalculatedCaution + finalCalculatedLegal;
    }

    const billingStart = new Date(renewalStart);
    billingStart.setUTCFullYear(billingStart.getUTCFullYear() - 1);

    // Year 1: the 12-month period the tenant is currently in (ending at nextDueDate)
    const year1RentCalc = calculateEffectiveRent(rentBase, billingStart, 12, false, rentOrigin);
    const year1ServiceCalc = calculateEffectiveRent(serviceBase, billingStart, 12, false, rentOrigin);
    const year1AnnualRent = year1RentCalc.totalAmount;
    const year1AnnualService = year1ServiceCalc.totalAmount;
    const year1Total = year1AnnualRent + year1AnnualService + finalCalculatedCaution + finalCalculatedLegal;

    // Year 2: the next renewal period starting from nextDueDate — will show increased rate
    // if the 2-year anniversary falls within this period.
    const year2RentCalc = calculateEffectiveRent(rentBase, renewalStart, 12, false, rentOrigin);
    const year2ServiceCalc = calculateEffectiveRent(serviceBase, renewalStart, 12, false, rentOrigin);
    const year2Total = year2RentCalc.totalAmount + year2ServiceCalc.totalAmount;

    const yearlyBreakdown = {
      year1: {
        label: 'Current Year',
        billingStart: billingStart,
        billingEnd: renewalStart,
        monthlyRent: year1RentCalc.finalRent,
        monthlyServiceCharge: year1ServiceCalc.finalRent,
        annualRent: year1AnnualRent,
        annualServiceCharge: year1AnnualService,
        ...(finalCalculatedCaution > 0 && { cautionFee: finalCalculatedCaution }),
        ...(finalCalculatedLegal > 0 && { legalFee: finalCalculatedLegal }),
        oneTimeFees: finalCalculatedCaution + finalCalculatedLegal,
        total: year1Total
      },
      year2: {
        label: 'Renewal Year',
        billingStart: renewalStart,
        billingEnd: (() => { const d = new Date(renewalStart); d.setMonth(d.getMonth() + 12); return d; })(),
        monthlyRent: year2RentCalc.finalRent,
        monthlyServiceCharge: year2ServiceCalc.finalRent,
        annualRent: year2RentCalc.totalAmount,
        annualServiceCharge: year2ServiceCalc.totalAmount,
        oneTimeFees: 0,
        total: year2Total,
        rentIncreased: year2RentCalc.finalRent > year1RentCalc.finalRent
      }
    };

    const overview = {
      name: tenant.tenantName,
      unit: tenant.unit ? tenant.unit.label : 'N/A',
      email: tenant.tenantEmail,
      phone: tenant.tenantPhone,

      // Pricing breakdown
      rent: currentCalculatedRent,
      storedRent: rentBase0,
      rentIncreased: currentCalculatedRent > rentBase0,

      serviceCharge: currentCalculatedService,
      storedServiceCharge: serviceBase0,
      serviceChargeIncreased: currentCalculatedService > serviceBase0,

      cautionFee: finalCalculatedCaution,
      legalFee: finalCalculatedLegal,

      // Total stay calculation (Rent + Service Charge)
      leaseDurationMonths,
      totalLeaseAmount,

      // Yearly lease cost breakdown
      yearlyBreakdown,

      unitMonthlyPrice: tenant.unit ? tenant.unit.monthlyPrice : null,
      serviceChargeMonthly: tenant.unit ? tenant.unit.serviceChargeMonthly : null,
      unitCautionFee: tenant.unit ? tenant.unit.cautionFee : null,
      unitLegalFee: tenant.unit ? tenant.unit.legalFee : null,

      nextDue: renewalStart,
      entryDate: tenant.entryDate,
      meter: tenant.electricMeterNumber,
      type: tenant.tenantType,
      typeBadge: tenant.tenantType === 'new' ? 'New' : tenant.tenantType === 'existing' ? 'Existing' : 'Transfer',
      status: tenant.status,

      // Outstanding balances (may exist independently of nextDue status)
      rentOutstanding: tenant.rentOutstanding || 0,
      serviceChargeOutstanding: tenant.serviceChargeOutstanding || 0,
      totalOutstanding: (tenant.rentOutstanding || 0) + (tenant.serviceChargeOutstanding || 0),
      hasOutstanding: ((tenant.rentOutstanding || 0) + (tenant.serviceChargeOutstanding || 0)) > 0,
      // How many months past nextDue (0 if current)
      arrearsMonths: renewalStart < new Date()
        ? Math.floor((new Date() - renewalStart) / (1000 * 60 * 60 * 24 * 30))
        : 0
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
      serviceChargeAmount,
      tenantType,
      status,
      electricMeterNumber,
      entryDate,
      nextDueDate,
      rentOutstanding,
      serviceChargeOutstanding
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
    let newServiceChargeAmount = undefined;
    const historyMeta = {};

    if (rentAmount !== undefined) {
      newRentAmount = parseInt(rentAmount);
      if (newRentAmount !== tenant.rentAmount) {
        historyMeta.oldRent = tenant.rentAmount;
        historyMeta.newRent = newRentAmount;
      }
      tenant.rentAmount = newRentAmount;
    }

    if (serviceChargeAmount !== undefined) {
      newServiceChargeAmount = parseInt(serviceChargeAmount);
      if (newServiceChargeAmount !== tenant.serviceChargeAmount) {
        historyMeta.oldServiceCharge = tenant.serviceChargeAmount;
        historyMeta.newServiceCharge = newServiceChargeAmount;
      }
      tenant.serviceChargeAmount = newServiceChargeAmount;
    }

    if (tenantType !== undefined) {
      if (tenantType !== tenant.tenantType) historyMeta.tenantType = tenantType;
      tenant.tenantType = tenantType;
    }
    if (status !== undefined) {
      tenant.status = status;
      if (tenant.user) {
        if (status === 'vacant') {
          await User.findByIdAndUpdate(tenant.user, { isActive: false });
        } else if (status === 'occupied') {
          await User.findByIdAndUpdate(tenant.user, { isActive: true });
        }
      }
    }
    if (electricMeterNumber !== undefined) tenant.electricMeterNumber = electricMeterNumber;

    if (entryDate !== undefined) {
      tenant.entryDate = parseFlexibleDate(entryDate);
    }

    if (nextDueDate !== undefined) {
      tenant.nextDueDate = parseFlexibleDate(nextDueDate);
    }

    // Allow admin to manually reduce or clear carried-over outstanding balances
    if (rentOutstanding !== undefined) {
      tenant.rentOutstanding = Math.max(0, Number(rentOutstanding) || 0);
    }
    if (serviceChargeOutstanding !== undefined) {
      tenant.serviceChargeOutstanding = Math.max(0, Number(serviceChargeOutstanding) || 0);
    }

    if (req.user?.id) tenant.updatedBy = req.user.id;
    // Backfill createdBy for old records that were saved without it (prevents Mongoose ValidationError)
    if (!tenant.createdBy && req.user?._id) tenant.createdBy = req.user._id;

    // Record a note in history if significant fields changed
    if (Object.keys(historyMeta).length > 0) {
      tenant.history.push({
        event: 'note',
        note: 'Tenant information updated',
        meta: historyMeta,
        createdBy: req.user?._id
      });
    }

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

    // If service charge changed and this tenant has a unit, mirror it to the unit
    if (newServiceChargeAmount != null && tenant.unit) {
      try {
        await Unit.findByIdAndUpdate(tenant.unit, {
          serviceChargeMonthly: newServiceChargeAmount,
          updatedBy: req.user?.id,
        });
      } catch (e) {
        logWarning('Failed to sync unit serviceChargeMonthly from tenant serviceChargeAmount', {
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

    const { amount, type, method, status, reference, periodMonth, periodYear, notes, durationMonths } = req.body;
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

    // Auto-advance nextDueDate for rent/service_charge payments
    let newDueDate = null;
    let appliedMonths = 0;
    if (['rent', 'service_charge'].includes(type) && status === 'paid') {
      // Use provided durationMonths, or default based on tenant type
      appliedMonths = durationMonths
        ? parseInt(durationMonths, 10)
        : (tenant.tenantType === 'new' ? 12 : 6);

      if (appliedMonths > 0) {
        const _base = tenant.nextDueDate
          ? new Date(tenant.nextDueDate)
          : (tenant.entryDate ? new Date(tenant.entryDate) : new Date());
        const baseDate = new Date(Date.UTC(_base.getUTCFullYear(), _base.getUTCMonth(), _base.getUTCDate()));
        newDueDate = new Date(baseDate);
        newDueDate.setUTCMonth(newDueDate.getUTCMonth() + appliedMonths);

        const oldDueDate = tenant.nextDueDate;
        tenant.nextDueDate = newDueDate;

        tenant.history.push({
          event: 'payment',
          note: `${type === 'rent' ? 'Rent' : 'Service charge'} payment recorded (${method || 'cash'}) for ${appliedMonths} month(s). Due date advanced to ${newDueDate.toISOString().split('T')[0]}`,
          meta: { amount, reference, type, durationMonths: appliedMonths, oldDueDate, newDueDate, txId: tx._id },
          createdBy: req.user?.id
        });
      }
    } else {
      // Non-rent payments — just log in history
      tenant.history.push({ event: 'payment', note: `Payment ${type}`, meta: { amount, reference }, createdBy: req.user?.id });
    }

    if (!tenant.createdBy && req.user?._id) tenant.createdBy = req.user._id;
    await tenant.save({ validateBeforeSave: false });

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
    const isExistingLike = ['existing', 'transfer'].includes(tenantType);

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

    // Expose caution and legal fees if configured and not yet paid
    if (true) { // Restriction removed: apply to all tenant types (existing, new, etc)
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

    // Deactivate linked user account so they can no longer log in
    if (tenant.user) {
      await User.findByIdAndUpdate(tenant.user, { isActive: false });
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
        const isExistingLike = ['existing', 'transfer'].includes(tenantType);

        // Predefined recurring items (Rent & Service Charge) — use dynamic rate
        const { getCurrentRent: _getRate } = require('../utils/rentCalculator');
        const dynamicRent = _getRate(
          tenant.rentAmount,
          tenant.entryDate || tenant.createdAt,
          false
        );
        const dynamicService = _getRate(
          tenant.serviceChargeAmount || unit.serviceChargeMonthly || 0,
          tenant.entryDate || tenant.createdAt,
          false
        );

        if (dynamicRent > 0) {
          recurring.unshift({
            code: 'rent',
            label: 'Rent',
            amount: dynamicRent,
            dueDate: tenant.nextDueDate,
            type: 'recurring',
            category: 'rent',
            frequency: 'monthly'
          });
        }

        if (dynamicService > 0) {
          recurring.push({
            code: 'service_charge',
            label: 'Service Charge',
            amount: dynamicService,
            dueDate: tenant.nextDueDate,
            type: 'recurring',
            category: 'service',
            frequency: 'monthly'
          });
        }

        // Outstanding onboarding balances — show as payable one-time items for existing tenants
        if ((tenant.rentOutstanding || 0) > 0) {
          oneTime.unshift({
            code: 'outstanding_rent',
            label: 'Outstanding Rent Balance',
            amount: tenant.rentOutstanding,
            type: 'one_time',
            category: 'fees',
            frequency: 'once',
            description: 'Carried-over rent balance from before system registration'
          });
        }
        if ((tenant.serviceChargeOutstanding || 0) > 0) {
          oneTime.push({
            code: 'outstanding_service_charge',
            label: 'Outstanding Service Charge Balance',
            amount: tenant.serviceChargeOutstanding,
            type: 'one_time',
            category: 'fees',
            frequency: 'once',
            description: 'Carried-over service charge balance from before system registration'
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
    const { itemIds, paymentMethod = 'wallet', durationMonths: rawDuration } = req.body;
    const durationMonths = rawDuration ? parseInt(rawDuration, 10) : 12;
    if (![6, 12].includes(durationMonths)) {
      return res.status(400).json({ success: false, message: 'Payment duration must be 6 or 12 months' });
    }

    // Support legacy format with billingCode and paymentType
    let items = itemIds;
    if (!items) {
      items = [];
      if (req.body.billingCode) {
        items.push(req.body.billingCode);
      }
      if (req.body.paymentType) {
        const typeItems = req.body.paymentType.split(',').map(s => s.trim());
        items.push(...typeItems);
      }
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ success: false, message: 'Please select at least one item to pay' });
    }

    const tenant = await Tenant.findOne({ user: req.user.id, isActive: true })
      .populate('estate', 'name')
      .populate('unit', 'label monthlyPrice serviceChargeMonthly cautionFee legalFee');

    // Validate all item IDs and calculate total
    let totalAmount = 0;
    const itemsToProcess = [];

    for (const itemId of items) {
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
          const { calculateEffectiveRent } = require('../utils/rentCalculator');
          const rentOrigin = tenant.entryDate || tenant.createdAt;
          const rentResult = calculateEffectiveRent(
            tenant.rentAmount,
            tenant.entryDate || new Date(),
            durationMonths,
            false,
            rentOrigin
          );
          totalAmount += rentResult.totalAmount;
          itemsToProcess.push({
            type: 'predefined',
            code: 'rent',
            label: `Rent (${durationMonths} months)`,
            amount: rentResult.totalAmount,
            duration: durationMonths
          });
        } else if (itemId === 'service_charge') {
          const serviceBase = tenant.serviceChargeAmount || tenant.unit?.serviceChargeMonthly || 0;
          if (serviceBase > 0) {
            const svcOrigin = tenant.entryDate || tenant.createdAt;
            const svcResult = calculateEffectiveRent(serviceBase, svcOrigin, durationMonths, false, svcOrigin);
            totalAmount += svcResult.totalAmount;
            itemsToProcess.push({
              type: 'predefined',
              code: 'service_charge',
              label: `Service Charge (${durationMonths} months)`,
              amount: svcResult.totalAmount,
              duration: durationMonths
            });
          }
        } else if (itemId === 'caution_fee' && tenant.unit?.cautionFee > 0) {
          const paidCaution = await Payment.exists({
            tenant: tenant._id,
            paymentStatus: 'completed',
            isActive: true,
            $or: [
              { paymentType: 'caution_fee' },
              { paymentType: { $in: ['initial', 'bundle'] }, 'paystackResponse.data.metadata.billing_items.code': 'caution_fee' },
              { paymentType: { $in: ['initial', 'bundle'] }, 'paystackResponse.data.metadata.billing_items.type': 'caution_fee' }
            ]
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
            paymentStatus: 'completed',
            isActive: true,
            $or: [
              { paymentType: 'legal_fee' },
              { paymentType: { $in: ['initial', 'bundle'] }, 'paystackResponse.data.metadata.billing_items.code': 'legal_fee' },
              { paymentType: { $in: ['initial', 'bundle'] }, 'paystackResponse.data.metadata.billing_items.type': 'legal_fee' }
            ]
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
        } else if (itemId === 'outstanding_rent' && (tenant.rentOutstanding || 0) > 0) {
          totalAmount += tenant.rentOutstanding;
          itemsToProcess.push({
            type: 'predefined',
            code: 'outstanding_rent',
            label: 'Outstanding Rent Balance',
            amount: tenant.rentOutstanding
          });
        } else if (itemId === 'outstanding_service_charge' && (tenant.serviceChargeOutstanding || 0) > 0) {
          totalAmount += tenant.serviceChargeOutstanding;
          itemsToProcess.push({
            type: 'predefined',
            code: 'outstanding_service_charge',
            label: 'Outstanding Service Charge Balance',
            amount: tenant.serviceChargeOutstanding
          });
        }
      }
    }

    if (itemsToProcess.length === 0) {
      return res.status(400).json({ success: false, message: 'No valid billing items found to process' });
    }

    if (totalAmount <= 0) {
      return res.status(400).json({ success: false, message: 'Total amount must be greater than zero' });
    }

    // Derive paymentType from actual items selected
    const validPaymentTypes = new Set(['rent', 'service_charge', 'caution_fee', 'legal_fee']);
    const predefinedCodes = itemsToProcess.filter(i => i.type === 'predefined').map(i => i.code);
    const hasBillingItems = itemsToProcess.some(i => i.type === 'billing_item');
    let resolvedPaymentType;
    if (!hasBillingItems && predefinedCodes.length === 1 && validPaymentTypes.has(predefinedCodes[0])) {
      resolvedPaymentType = predefinedCodes[0]; // rent | service_charge | caution_fee | legal_fee
    } else if (predefinedCodes.some(c => validPaymentTypes.has(c))) {
      resolvedPaymentType = 'bundle';
    } else {
      resolvedPaymentType = 'other';
    }

    // Handle wallet payment
    if (paymentMethod === 'wallet') {
      const wallet = await Wallet.findOne({ userId: req.user.id });
      if (!wallet) {
        return res.status(404).json({ success: false, message: 'Wallet not found' });
      }

      if (wallet.balance < totalAmount) {
        return res.status(400).json({
          success: false,
          message: 'Insufficient wallet balance',
          data: {
            balance: wallet.balance,
            required: totalAmount
          }
        });
      }

      // Deduct from wallet
      wallet.balance -= totalAmount;
      wallet.totalSpent += totalAmount;
      wallet.lastUpdated = new Date();
      await wallet.save();

      // Create completed payment record
      const reference = `wallet_billing_${req.user.id}_${Date.now()}`;
      const description = itemsToProcess.map(item => item.label).join(', ');

      const payment = await Payment.create({
        user: req.user.id,
        tenant: tenant?._id,
        estate: tenant?.estate?._id,
        admin: req.user.id,
        paymentType: resolvedPaymentType,
        amount: totalAmount,
        description,
        paystackReference: reference,
        paymentStatus: 'completed',
        paymentDate: new Date(),
        paymentMethod: 'wallet',
        createdBy: req.user.id,
        paystackResponse: {
          data: {
            metadata: {
              payment_type: 'multiple_billing_items',
              duration_months: durationMonths,
              billing_items: itemsToProcess
            }
          }
        }
      });

      // Mark billing items as paid
      for (const item of itemsToProcess) {
        if (item.type === 'billing_item') {
          await BillingItem.findByIdAndUpdate(item.id, {
            isPaid: true,
            paidDate: new Date(),
            paymentReference: payment._id
          });
        }
      }

      // Auto-advance nextDueDate for rent/service_charge payments
      if (tenant) {
        let tenantDirty = false;

        // Clear onboarding outstanding balances when paid
        if (itemsToProcess.some(i => i.code === 'outstanding_rent')) {
          tenant.rentOutstanding = 0;
          tenantDirty = true;
        }
        if (itemsToProcess.some(i => i.code === 'outstanding_service_charge')) {
          tenant.serviceChargeOutstanding = 0;
          tenantDirty = true;
        }

        // Reconcile before advancing so we always start from the correct base
        const correctedBase = await reconcileNextDueDate(tenant, Payment);
        if (correctedBase) tenant.nextDueDate = correctedBase;

        const rentMonths = itemsToProcess.some(i => i.code === 'rent') ? durationMonths : 0;
        const serviceMonths = itemsToProcess.some(i => i.code === 'service_charge') ? durationMonths : 0;
        const maxMonths = Math.max(rentMonths, serviceMonths);
        if (maxMonths > 0) {
          const _base = tenant.nextDueDate ? new Date(tenant.nextDueDate) : new Date();
          // Normalize base to midnight UTC so time never drifts
          const baseDate = new Date(Date.UTC(_base.getUTCFullYear(), _base.getUTCMonth(), _base.getUTCDate()));
          const newDueDate = new Date(baseDate);
          newDueDate.setUTCMonth(newDueDate.getUTCMonth() + maxMonths);
          const oldDueDate = tenant.nextDueDate;
          tenant.nextDueDate = newDueDate;
          tenant.history.push({
            event: 'payment',
            note: `Wallet payment (${description}). Due date advanced to ${newDueDate.toISOString().split('T')[0]}`,
            meta: { rentMonths, serviceMonths, oldDueDate, newDueDate, paymentId: payment._id },
            createdBy: req.user.id
          });
          tenantDirty = true;
        }

        if (tenantDirty) {
          await tenant.save({ validateBeforeSave: false });
        }
      }

      // Create Transaction record for history
      try {
        await Transaction.create({
          user: req.user.id,
          tenant: tenant?._id,
          estate: tenant?.estate?._id,
          amount: totalAmount,
          type: resolvedPaymentType,
          method: 'wallet',
          status: 'completed',
          reference,
          description,
          createdBy: req.user.id
        });
      } catch (txErr) {
        logError('Failed to create transaction record for wallet billing payment', txErr);
      }

      // Distribute funds (50/30/20) if tenant has an estate
      if (tenant?.estate?._id) {
        try {
          await distributePayment(tenant.estate._id, totalAmount, payment._id, resolvedPaymentType);
        } catch (distErr) {
          logError('Failed to distribute wallet billing payment', distErr, { paymentId: payment._id });
        }
      }

      // Send receipt email
      try {
        const { calculateReceiptData } = require('./paymentController');
        const { sendReceiptEmail } = require('../utils/emailService');
        const receiptData = await calculateReceiptData(tenant, payment, wallet);
        await sendReceiptEmail(receiptData, tenant, tenant.estate);
      } catch (emailError) {
        console.error('Failed to send receipt email:', emailError.message);
      }

      return res.status(200).json({
        success: true,
        message: 'Payment successful from wallet',
        data: {
          payment: {
            id: payment._id,
            reference: payment.paystackReference,
            amount: payment.amount,
            description: payment.description,
            paymentMethod: 'wallet',
            paymentStatus: 'completed',
            createdAt: payment.createdAt
          },
          newBalance: wallet.balance,
          items: itemsToProcess
        }
      });
    }

    // Only wallet payments are supported. Top up your wallet via bank deposit first.
    return res.status(400).json({
      success: false,
      message: 'Only wallet payments are supported. Please top up your wallet via bank deposit first.',
      data: { requiredAmount: totalAmount, items: itemsToProcess }
    });
  } catch (err) {
    console.error('Pay selected billing items error:', err);
    return res.status(500).json({ success: false, message: 'Server error occurred while processing payment' });
  }
}


/**
 * Reconcile a tenant's nextDueDate from their completed rent payments.
 * Starting from entryDate, advance by each payment's duration_months.
 * Returns the corrected Date, or null if no change is needed.
 * Persists the correction to the DB if the stored value is wrong.
 */
async function reconcileNextDueDate(tenant, PaymentModel) {
  if (!tenant.entryDate) return null;

  // Include rent-only AND bundle/initial payments that contain a rent component
  const allPayments = await PaymentModel.find({
    tenant: tenant._id,
    paymentType: { $in: ['rent', 'bundle', 'initial'] },
    paymentStatus: 'completed',
  }, 'paystackResponse paymentDate paymentType').sort({ paymentDate: 1 }).lean();

  // No payment history yet — the stored nextDueDate was explicitly set (e.g. admin onboarding
  // an existing tenant). Overwriting it with entryDate would destroy the correct value.
  if (allPayments.length === 0) return null;

  // Compute expected due date: entryDate + sum of all rent-covering paid durations
  let computed = new Date(tenant.entryDate);
  for (const p of allPayments) {
    // Metadata lives in paystackResponse.data.metadata (local store) or p.metadata (legacy)
    const meta = p.paystackResponse?.data?.metadata || p.paystackResponse?.metadata || {};
    const billingItems = meta.billing_items || [];
    // 'rent' always counts. 'bundle' always covers rent (rent + service charge).
    // 'initial' counts if billing_items include a rent component (Paystack path)
    // or if there are no billing_items at all (manual initial payment).
    const hasRent = p.paymentType === 'rent' || p.paymentType === 'bundle' ||
      billingItems.some(i => i.code === 'rent' || i.type === 'rent') ||
      (p.paymentType === 'initial' && billingItems.length === 0);

    if (!hasRent) continue;

    let months = meta.duration_months || 0;
    if (!months) {
      for (const item of billingItems) {
        if (item.code === 'rent' || item.type === 'rent') {
          months = Math.max(months, item.duration || 0);
        }
      }
    }
    if (!months) months = 12; // safe default: 1-year contract
    computed = new Date(computed);
    computed.setMonth(computed.getMonth() + months);
  }

  // Normalise to midnight UTC
  computed = new Date(Date.UTC(computed.getUTCFullYear(), computed.getUTCMonth(), computed.getUTCDate()));

  const storedMs = tenant.nextDueDate ? new Date(tenant.nextDueDate).getTime() : 0;
  const computedMs = computed.getTime();

  if (Math.abs(storedMs - computedMs) > 86400000) {
    // More than 1 day off — persist the correction
    await Tenant.findByIdAndUpdate(tenant._id, { nextDueDate: computed });
    return computed;
  }
  return null;
}

// @desc    Get logged-in user's own tenant record
// @route   GET /api/tenants/me
// @access  Private (tenant)
async function getMyTenant(req, res) {
  try {
    const tenant = await Tenant.findOne({ user: req.user._id, isActive: true })
      .populate('estate', 'name description images address')
      .populate('unit', 'label category bedrooms bathrooms monthlyPrice floor');

    if (!tenant) {
      return res.status(404).json({ success: false, message: 'No tenant record found for this account' });
    }

    const reconciledDueDate = await reconcileNextDueDate(tenant, Payment);
    if (reconciledDueDate) tenant.nextDueDate = reconciledDueDate;

    const unpaidCount = await BillingItem.countDocuments({
      tenant: tenant._id,
      status: { $in: ['pending', 'overdue'] },
      isActive: true,
    });

    res.status(200).json({
      success: true,
      data: {
        ...tenant.toObject(),
        unpaidBillingCount: unpaidCount,
      },
    });
  } catch (err) {
    logError('GET /api/tenants/me', err, { userId: req.user?._id });
    res.status(500).json({ success: false, message: 'Server error fetching tenant record' });
  }
}

// @desc    Upload avatar for the logged-in tenant's own profile
// @route   POST /api/tenants/me/avatar
// @access  Private (tenant)
async function uploadMyAvatar(req, res) {
  try {
    const tenant = await Tenant.findOne({ user: req.user._id, isActive: true });
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'No tenant record found' });
    }
    // Delegate to uploadTenantAvatar logic by forwarding req.params.id
    req.params.id = tenant._id.toString();
    return uploadTenantAvatar(req, res);
  } catch (err) {
    logError('POST /api/tenants/me/avatar', err, { userId: req.user?._id });
    res.status(500).json({ success: false, message: 'Server error uploading avatar' });
  }
}

// @desc    Get quarterly rent breakdown by due month
// @route   GET /api/tenants/:id/quarterly-rent
// @access  Private
async function getQuarterlyRentByDueMonth(req, res) {
  try {
    const tenant = await Tenant.findById(req.params.id);
    if (!tenant) {
      return res.status(404).json({ success: false, message: 'Tenant not found' });
    }

    const transactions = await Transaction.find({ tenant: tenant._id })
      .sort({ createdAt: -1 })
      .lean();

    // Group by quarter (month)
    const byMonth = {};
    for (const tx of transactions) {
      const d = new Date(tx.createdAt);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      if (!byMonth[key]) byMonth[key] = { month: key, total: 0, count: 0 };
      byMonth[key].total += tx.amount || 0;
      byMonth[key].count += 1;
    }

    res.status(200).json({
      success: true,
      data: Object.values(byMonth).sort((a, b) => b.month.localeCompare(a.month)),
    });
  } catch (err) {
    logError('GET /api/tenants/:id/quarterly-rent', err, { id: req.params.id });
    res.status(500).json({ success: false, message: 'Server error fetching quarterly rent data' });
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
  getMyBillingItems,
  paySelectedBillingItems,
  getQuarterlyRentByDueMonth,
  reconcileNextDueDate,
};
