const Estate = require('../models/Estate');
const Tenant = require('../models/Tenant');
const Transaction = require('../models/Transaction');
const { validationResult } = require('express-validator');
const { logError, logInfo, logWarning } = require('../utils/logger');
const { sendActivityToSlack } = require('../utils/slackService');

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

    sendActivityToSlack('New Estate Created', {
      name: estate.name,
      units: estate.totalUnits,
      createdBy: req.user.name || req.user.email
    }, '#439FE0', '🏗️');

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
    const {
      page = 1,
      limit = 20,
      search,
      sortBy = 'createdAt',
      order = 'desc',
      minUnits,
      maxUnits,
      createdAfter,
      createdBefore
    } = req.query;

    // Build base filter
    const filter = { isActive: true };

    // Apply RBAC filtering based on user role
    if (req.user.role === 'business_owner') {
      // Business owners see only their estates
      filter.$or = [
        { owner: req.user.id },
        { createdBy: req.user.id }
      ];
    } else if (req.user.role === 'admin') {
      // Admins see only estates they manage
      filter.managers = req.user.id;
    }
    // Super admins see all estates (no additional filter)

    // Search filter
    if (search) {
      filter.name = new RegExp(search, 'i');
    }

    // Unit range filters
    if (minUnits || maxUnits) {
      filter.totalUnits = {};
      if (minUnits) filter.totalUnits.$gte = parseInt(minUnits);
      if (maxUnits) filter.totalUnits.$lte = parseInt(maxUnits);
    }

    // Date range filters
    if (createdAfter || createdBefore) {
      filter.createdAt = {};
      if (createdAfter) filter.createdAt.$gte = new Date(createdAfter);
      if (createdBefore) {
        const endDate = new Date(createdBefore);
        endDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = endDate;
      }
    }

    // Build sort object
    const sortField = ['name', 'createdAt', 'totalUnits'].includes(sortBy) ? sortBy : 'createdAt';
    const sortOrder = order === 'asc' ? 1 : -1;
    const sortObj = { [sortField]: sortOrder };

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [items, total] = await Promise.all([
      Estate.find(filter).sort(sortObj).skip(skip).limit(parseInt(limit)),
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
    logError('GET /api/estates', err, { page, limit, search, sortBy, order });
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

    // RBAC: Check if user has access to this estate
    if (req.user.role === 'business_owner') {
      // Business owner must own this estate
      const hasAccess = estate.owner && estate.owner.toString() === req.user.id;
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this estate'
        });
      }
    } else if (req.user.role === 'admin') {
      // Admin must be in managers array
      const hasAccess = estate.managers && estate.managers.some(m => m.toString() === req.user.id);
      if (!hasAccess) {
        return res.status(403).json({
          success: false,
          message: 'You do not have access to this estate'
        });
      }
    }
    // Super admin has access to all estates

    const {
      period, year, month, startDate, endDate
    } = req.query;

    const now = new Date();
    let filterStartDate, filterEndDate;

    // Calculate date range based on period filter (Same as overall overview)
    if (year || month) {
      const targetYear = year ? parseInt(year) : now.getFullYear();
      const targetMonth = month ? parseInt(month) - 1 : 0;
      if (month) {
        filterStartDate = new Date(targetYear, targetMonth, 1);
        filterEndDate = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);
      } else {
        filterStartDate = new Date(targetYear, 0, 1);
        filterEndDate = new Date(targetYear, 11, 31, 23, 59, 59, 999);
      }
    } else if (period === 'custom' && startDate && endDate) {
      filterStartDate = new Date(startDate);
      filterEndDate = new Date(endDate);
      filterEndDate.setHours(23, 59, 59, 999);
    } else {
      const targetYear = year ? parseInt(year) : now.getFullYear();
      switch (period) {
        case 'today':
          filterStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          filterEndDate = now;
          break;
        case 'week':
          filterStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          filterEndDate = now;
          break;
        case 'quarter':
          filterStartDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          filterEndDate = now;
          break;
        case 'Q1':
          filterStartDate = new Date(targetYear, 0, 1);
          filterEndDate = new Date(targetYear, 2, 31, 23, 59, 59, 999);
          break;
        case 'Q2':
          filterStartDate = new Date(targetYear, 3, 1);
          filterEndDate = new Date(targetYear, 5, 30, 23, 59, 59, 999);
          break;
        case 'Q3':
          filterStartDate = new Date(targetYear, 6, 1);
          filterEndDate = new Date(targetYear, 8, 30, 23, 59, 59, 999);
          break;
        case 'Q4':
          filterStartDate = new Date(targetYear, 9, 1);
          filterEndDate = new Date(targetYear, 11, 31, 23, 59, 59, 999);
          break;
        case '6_months':
          filterStartDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
          filterEndDate = now;
          break;
        case 'year':
          filterStartDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          filterEndDate = now;
          break;
        case 'month':
        default:
          filterStartDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          filterEndDate = now;
          break;
      }
    }

    const { getWalletBalance } = require('../utils/distributionService');
    const { getCurrentRent } = require('../utils/rentCalculator');

    // Get basic stats and wallet balance
    const [occupiedCount, tenantsDueSoon, requestedRevenueAgg, walletBalance, allActiveTenants] = await Promise.all([
      Tenant.countDocuments({ estate: estate._id, isActive: true, status: { $in: ['occupied', 'pending'] } }),
      Tenant.countDocuments({ estate: estate._id, isActive: true, nextDueDate: { $gte: new Date(), $lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) } }),
      Transaction.aggregate([
        { $match: { estate: estate._id, isActive: true, status: 'paid', createdAt: { $gte: filterStartDate, $lte: filterEndDate } } },
        { $group: { _id: '$type', total: { $sum: '$amount' }, count: { $sum: 1 } } }
      ]),
      getWalletBalance(estate._id),
      Tenant.find({ estate: estate._id, isActive: true, status: { $in: ['occupied', 'pending'] } })
        .select('rentAmount serviceChargeAmount baseRent2024 lastRentIncreaseDate entryDate createdAt baseServiceCharge2024 lastServiceIncreaseDate unit')
        .populate('unit', 'serviceChargeMonthly')
    ]);

    // Calculate Potential Revenue (Projections)
    let potentialMonthlyRevenue = 0;
    allActiveTenants.forEach(tenant => {
      const currentPrice = getCurrentRent(
        tenant.baseRent2024 || tenant.rentAmount,
        tenant.lastRentIncreaseDate || tenant.entryDate || tenant.createdAt,
        false
      );
      const currentService = getCurrentRent(
        tenant.baseServiceCharge2024 || tenant.serviceChargeAmount || tenant.unit?.serviceChargeMonthly || 0,
        tenant.lastServiceIncreaseDate || tenant.entryDate || tenant.createdAt,
        false
      );
      potentialMonthlyRevenue += (currentPrice + currentService);
    });

    // Breakdown income by category
    const incomeByCategory = {};
    let periodRevenue = 0;
    let periodTxCount = 0;

    requestedRevenueAgg.forEach(item => {
      incomeByCategory[item._id] = item.total;
      periodRevenue += item.total;
      periodTxCount += item.count;
    });

    const totalUnits = estate.totalUnits || 0;
    const occupiedUnits = occupiedCount;
    const vacantUnits = Math.max(totalUnits - occupiedUnits, 0);

    return res.status(200).json({
      success: true,
      data: {
        estate: {
          _id: estate._id,
          name: estate.name,
          totalUnits,
          createdAt: estate.createdAt
        },
        occupancy: {
          totalUnits,
          occupiedUnits,
          vacantUnits,
          occupancyRate: totalUnits > 0 ? (occupiedUnits / totalUnits) * 100 : 0
        },
        projections: {
          monthly: potentialMonthlyRevenue,
          yearly: potentialMonthlyRevenue * 12,
          currency: 'NGN'
        },
        wallets: {
          marketing: walletBalance.marketing.balance,
          operations: walletBalance.operations.balance,
          owner: walletBalance.owner.balance,
          totalAvailable: walletBalance.totalBalance
        },
        billing: {
          upcomingDueCount: tenantsDueSoon,
          periodStats: {
            period: period || 'last_30_days',
            year: year || now.getFullYear(),
            revenue: periodRevenue,
            transactions: periodTxCount,
            breakdown: incomeByCategory
          }
        }
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

    sendActivityToSlack('Estate Deleted', {
      name: estate.name,
      deletedBy: req.user.name || req.user.email
    }, '#ff0000', '🗑️');

    res.status(200).json({ success: true, message: 'Estate deleted successfully' });
  } catch (err) {
    logError('DELETE /api/estates/:id', err, { estateId: req.params.id });
    if (err.name === 'CastError') {
      return res.status(404).json({ success: false, message: 'Estate not found' });
    }
    res.status(500).json({ success: false, message: 'Server error occurred while deleting estate' });
  }
};

// Overall estate overview (all estates)
const getOverallEstateOverview = async (req, res) => {
  try {
    const {
      period, year, month, startDate, endDate,
      estateIds, unitStatus, tenantStatus, paymentStatus
    } = req.query;

    const now = new Date();
    let filterStartDate, filterEndDate;

    // Calculate date range based on period filter
    if (year || month) {
      // Year/Month specific filter
      const targetYear = year ? parseInt(year) : now.getFullYear();
      const targetMonth = month ? parseInt(month) - 1 : 0; // 0-indexed

      if (month) {
        // Specific month
        filterStartDate = new Date(targetYear, targetMonth, 1);
        filterEndDate = new Date(targetYear, targetMonth + 1, 0, 23, 59, 59, 999);
      } else {
        // Entire year
        filterStartDate = new Date(targetYear, 0, 1);
        filterEndDate = new Date(targetYear, 11, 31, 23, 59, 59, 999);
      }
    } else if (period === 'custom' && startDate && endDate) {
      // Custom date range
      filterStartDate = new Date(startDate);
      filterEndDate = new Date(endDate);
      filterEndDate.setHours(23, 59, 59, 999);
    } else {
      // Predefined periods
      const targetYear = year ? parseInt(year) : now.getFullYear();
      switch (period) {
        case 'today':
          filterStartDate = new Date(now.getFullYear(), now.getMonth(), now.getDate());
          filterEndDate = now;
          break;
        case 'week':
          filterStartDate = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
          filterEndDate = now;
          break;
        case 'quarter':
          filterStartDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
          filterEndDate = now;
          break;
        case 'Q1':
          filterStartDate = new Date(targetYear, 0, 1);
          filterEndDate = new Date(targetYear, 2, 31, 23, 59, 59, 999);
          break;
        case 'Q2':
          filterStartDate = new Date(targetYear, 3, 1);
          filterEndDate = new Date(targetYear, 5, 30, 23, 59, 59, 999);
          break;
        case 'Q3':
          filterStartDate = new Date(targetYear, 6, 1);
          filterEndDate = new Date(targetYear, 8, 30, 23, 59, 59, 999);
          break;
        case 'Q4':
          filterStartDate = new Date(targetYear, 9, 1);
          filterEndDate = new Date(targetYear, 11, 31, 23, 59, 59, 999);
          break;
        case '6_months':
          filterStartDate = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000);
          filterEndDate = now;
          break;
        case 'year':
          filterStartDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
          filterEndDate = now;
          break;
        case 'month':
        default:
          // Default to last 30 days
          filterStartDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
          filterEndDate = now;
          break;
      }
    }

    // Calculate upcoming due date windows
    const next7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    const next30Days = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

    // Build estate filter
    const estateFilter = { isActive: true };

    // Apply RBAC filtering
    if (req.user.role === 'business_owner') {
      // Business owners see only their estates
      estateFilter.$or = [
        { owner: req.user.id },
        { createdBy: req.user.id }
      ];
    } else if (req.user.role === 'admin') {
      // Admins see only estates they manage
      estateFilter.managers = req.user.id;
    }
    // Super admin sees all estates (no additional filter)

    if (estateIds) {
      const ids = estateIds.split(',').map(id => id.trim());
      // Combine with RBAC filter if it exists
      if (estateFilter.$or || estateFilter.managers) {
        estateFilter.$and = [
          { $or: estateFilter.$or ? estateFilter.$or : [{ managers: estateFilter.managers }] },
          { _id: { $in: ids } }
        ];
        delete estateFilter.$or;
        delete estateFilter.managers;
      } else {
        estateFilter._id = { $in: ids };
      }
    }

    // Build unit filter
    const Unit = require('../models/Unit');
    const unitFilter = { isActive: true };
    if (estateIds) {
      const ids = estateIds.split(',').map(id => id.trim());
      unitFilter.estate = { $in: ids };
    }
    if (unitStatus) {
      unitFilter.status = unitStatus;
    }

    // Build tenant filter
    const tenantFilter = { isActive: true };
    if (estateIds) {
      const ids = estateIds.split(',').map(id => id.trim());
      tenantFilter.estate = { $in: ids };
    }
    if (tenantStatus) {
      tenantFilter.status = tenantStatus;
    } else {
      // Default: active tenants
      tenantFilter.status = { $in: ['occupied', 'pending'] };
    }

    // Build transaction filter
    const transactionFilter = {
      isActive: true,
      status: 'paid',
      createdAt: { $gte: filterStartDate, $lte: filterEndDate }
    };
    if (estateIds) {
      const ids = estateIds.split(',').map(id => id.trim());
      transactionFilter.estate = { $in: ids };
    }

    // Build payment filter
    const Payment = require('../models/Payment');
    const paymentFilter = { isActive: true };
    if (estateIds) {
      const ids = estateIds.split(',').map(id => id.trim());
      paymentFilter.estate = { $in: ids };
    }
    if (paymentStatus) {
      paymentFilter.paymentStatus = paymentStatus;
    }

    // Get all data in parallel
    const [
      totalEstates,
      unitsAgg,
      activeTenantCount,
      dueSoon7Count,
      dueSoon30Count,
      revenueAgg,
      pendingPaymentCount,
      completedPaymentCount
    ] = await Promise.all([
      // Total estates (with filter)
      Estate.countDocuments(estateFilter),

      // Aggregate unit statistics (with filters)
      Unit.aggregate([
        { $match: unitFilter },
        {
          $group: {
            _id: null,
            totalUnits: { $sum: 1 },
            occupiedUnits: {
              $sum: { $cond: [{ $eq: ['$status', 'occupied'] }, 1, 0] }
            },
            vacantUnits: {
              $sum: { $cond: [{ $eq: ['$status', 'vacant'] }, 1, 0] }
            },
            maintenanceUnits: {
              $sum: { $cond: [{ $eq: ['$status', 'maintenance'] }, 1, 0] }
            },
            reservedUnits: {
              $sum: { $cond: [{ $eq: ['$status', 'reserved'] }, 1, 0] }
            }
          }
        }
      ]),

      // Total active tenants (with filters)
      Tenant.countDocuments(tenantFilter),

      // Tenants due in next 7 days
      Tenant.countDocuments({
        ...tenantFilter,
        nextDueDate: { $gte: now, $lte: next7Days }
      }),

      // Tenants due in next 30 days
      Tenant.countDocuments({
        ...tenantFilter,
        nextDueDate: { $gte: now, $lte: next30Days }
      }),

      // Revenue for selected period
      Transaction.aggregate([
        { $match: transactionFilter },
        {
          $group: {
            _id: null,
            total: { $sum: '$amount' },
            count: { $sum: 1 }
          }
        }
      ]),

      // Pending payments count
      Payment.countDocuments({
        ...paymentFilter,
        paymentStatus: { $in: ['pending', 'initiated'] }
      }),

      // Completed payments in selected period
      Payment.countDocuments({
        ...paymentFilter,
        paymentStatus: 'completed',
        createdAt: { $gte: filterStartDate, $lte: filterEndDate }
      })
    ]);

    // Extract unit stats
    const unitStats = unitsAgg[0] || {
      totalUnits: 0,
      occupiedUnits: 0,
      vacantUnits: 0,
      maintenanceUnits: 0,
      reservedUnits: 0
    };

    const totalUnits = unitStats.totalUnits;
    const occupancyRate = totalUnits > 0 ? unitStats.occupiedUnits / totalUnits : 0;

    // Extract revenue stats
    const revenue = revenueAgg[0]?.total || 0;
    const txCount = revenueAgg[0]?.count || 0;

    // Determine period label
    let periodLabel = 'Custom Period';
    if (year && month) {
      const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];
      periodLabel = `${monthNames[month - 1]} ${year}`;
    } else if (year) {
      periodLabel = `Year ${year}`;
    } else {
      periodLabel = period === 'today' ? 'Today' :
        period === 'week' ? 'Last 7 Days' :
          period === 'quarter' ? 'Last 90 Days' :
            period === 'year' ? 'Last 365 Days' :
              'Last 30 Days';
    }

    return res.status(200).json({
      success: true,
      data: {
        period: {
          label: periodLabel,
          startDate: filterStartDate,
          endDate: filterEndDate
        },
        estates: {
          totalEstates,
          activeEstates: totalEstates
        },
        units: {
          totalUnits,
          occupiedUnits: unitStats.occupiedUnits,
          vacantUnits: unitStats.vacantUnits,
          maintenanceUnits: unitStats.maintenanceUnits,
          reservedUnits: unitStats.reservedUnits,
          occupancyRate: Math.round(occupancyRate * 10000) / 100
        },
        tenants: {
          totalActiveTenants: activeTenantCount,
          dueSoon7Days: dueSoon7Count,
          dueSoon30Days: dueSoon30Count
        },
        revenue: {
          amount: revenue,
          transactionCount: txCount
        },
        payments: {
          pendingCount: pendingPaymentCount,
          completedInPeriod: completedPaymentCount
        }
      }
    });
  } catch (err) {
    logError('GET /api/estates/overview/all', err);
    res.status(500).json({
      success: false,
      message: 'Server error occurred while fetching overall estate overview'
    });
  }
};

module.exports = {
  createEstate,
  getEstates,
  getEstate,
  updateEstate,
  deleteEstate,
  getEstateOverview,
  getOverallEstateOverview,
};
