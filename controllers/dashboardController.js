const mongoose = require('mongoose');
const User = require('../models/User');
const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const Unit = require('../models/Unit');
const Payment = require('../models/Payment');
const BillingItem = require('../models/BillingItem');
const Wallet = require('../models/Wallet');
const ServiceRequest = require('../models/ServiceRequest');
const Notification = require('../models/Notification');
const { logError, logInfo } = require('../utils/logger');

/**
 * Unified Overview Endpoint
 * Returns different data based on user role
 * GET /api/dashboard/overview
 */
const getOverview = async (req, res) => {
  try {
    const userId = req.user._id;
    const role = req.user.role;

    let overviewData = {
      role,
      user: {
        id: req.user._id,
        name: req.user.name,
        email: req.user.email,
        role: req.user.role,
        profileImageUrl: req.user.profileImageUrl
      },
      timestamp: new Date(),
      data: {}
    };

    // Route based on role
    switch (role) {
      case 'tenant':
      case 'user':
        overviewData.data = await getTenantOverview(userId);
        break;
      case 'business_owner':
      case 'admin':
        overviewData.data = await getBusinessOwnerOverview(userId);
        break;
      case 'vendor':
      case 'super_vendor':
        overviewData.data = await getVendorOverview(userId);
        break;
      case 'manager':
      case 'super_manager':
        overviewData.data = await getManagerOverview(userId);
        break;
      case 'super_admin':
        overviewData.data = await getSuperAdminOverview();
        break;
      default:
        overviewData.data = await getTenantOverview(userId);
    }

    return res.status(200).json({
      success: true,
      message: `${role} overview retrieved successfully`,
      data: overviewData
    });
  } catch (error) {
    logError('Error fetching overview', { error: error.message });
    return res.status(500).json({
      success: false,
      message: 'Error fetching overview',
      error: error.message
    });
  }
};

/**
 * TENANT OVERVIEW
 * Shows apartment info, billing, payments, wallet
 */
const getTenantOverview = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  // Find tenant records linked to this user
  const tenant = await Tenant.findOne({ user: userId })
    .populate('estate', 'name address')
    .populate('unit', 'label unitType');

  let overview = {
    section: 'TENANT_OVERVIEW',
    apartment: null,
    billing: {
      totalPending: 0,
      totalPaid: 0,
      upcomingDue: [],
      overdue: []
    },
    payments: {
      recentPayments: [],
      totalPaid: 0
    },
    wallet: {
      balance: 0,
      currency: 'NGN'
    },
    notifications: []
  };

  if (tenant) {
    // Auto-calculate nextDueDate if missing (backward compatibility)
    let nextDueDate = tenant.nextDueDate;
    if (!nextDueDate && tenant.entryDate) {
      nextDueDate = new Date(tenant.entryDate);
      nextDueDate.setMonth(nextDueDate.getMonth() + 12);
    }

    // Apartment info
    overview.apartment = {
      id: tenant._id,
      tenantName: tenant.tenantName,
      unit: tenant.unit?.label || 'N/A',
      unitType: tenant.unit?.unitType || 'N/A',
      estate: tenant.estate?.name || 'N/A',
      rentAmount: tenant.rentAmount,
      serviceChargeAmount: tenant.serviceChargeAmount,
      entryDate: tenant.entryDate,
      nextDueDate: nextDueDate,
      status: tenant.status,
      leaseEndsOn: tenant.leaseEndDate
    };

    // Billing Overview
    const billingItems = await BillingItem.find({
      tenant: tenant._id,
      isActive: true
    }).sort({ dueDate: 1 });

    const now = new Date();
    let totalPending = 0;
    let totalPaid = 0;

    billingItems.forEach(item => {
      if (item.isPaid) {
        totalPaid += item.amount;
      } else {
        totalPending += item.amount;
        const itemData = {
          id: item._id,
          label: item.label,
          itemType: item.itemType,
          amount: item.amount,
          dueDate: item.dueDate,
          description: item.description
        };

        // Categorize as overdue or upcoming
        if (item.dueDate && new Date(item.dueDate) < now) {
          overview.billing.overdue.push({
            ...itemData,
            daysOverdue: Math.floor((now - item.dueDate) / (1000 * 60 * 60 * 24))
          });
        } else {
          overview.billing.upcomingDue.push(itemData);
        }
      }
    });

    overview.billing.totalPending = totalPending;
    overview.billing.totalPaid = totalPaid;

    // Recent Payments
    const recentPayments = await Payment.find({
      tenant: tenant._id,
      paymentStatus: 'completed'
    })
      .sort({ createdAt: -1 })
      .limit(5);

    overview.payments.recentPayments = recentPayments.map(p => ({
      id: p._id,
      amount: p.amount,
      paymentType: p.paymentType,
      description: p.description,
      date: p.createdAt,
      reference: p.paystackReference
    }));

    const totalPaymentAmount = await Payment.aggregate([
      {
        $match: {
          tenant: new mongoose.Types.ObjectId(tenant._id),
          paymentStatus: 'completed'
        }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);

    overview.payments.totalPaid = totalPaymentAmount.length > 0 ? totalPaymentAmount[0].total : 0;
  }

  // Wallet info
  const wallet = await Wallet.findOne({ userId });
  if (wallet) {
    overview.wallet = {
      balance: wallet.balance,
      totalEarnings: wallet.totalEarnings,
      totalSpent: wallet.totalSpent,
      currency: wallet.currency
    };
  }

  // Recent Notifications
  const notifications = await Notification.find({
    recipient: userId,
    isRead: false
  })
    .sort({ createdAt: -1 })
    .limit(5);

  overview.notifications = notifications.map(n => ({
    id: n._id,
    title: n.title,
    message: n.message,
    type: n.type,
    createdAt: n.createdAt
  }));

  return overview;
};

/**
 * BUSINESS OWNER / ADMIN OVERVIEW
 * Shows estates, units, tenants, financial summary
 */
const getBusinessOwnerOverview = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  // Get estates assigned to this user
  const estates = await Estate.find({
    $or: [{ createdBy: userId }, { _id: { $in: user.assignedEstates || [] } }]
  });

  const estateIds = estates.map(e => e._id);

  let overview = {
    section: 'BUSINESS_OWNER_OVERVIEW',
    estates: [],
    statistics: {
      totalEstates: estates.length,
      totalUnits: 0,
      occupiedUnits: 0,
      vacantUnits: 0,
      totalTenants: 0,
      totalRevenueGenerated: 0,
      pendingPayments: 0,
      unpaidBills: 0
    },
    recentPayments: [],
    topStats: {}
  };

  // Get detailed stats for each estate
  for (const estate of estates) {
    const units = await Unit.find({ estate: estate._id, isActive: true });
    const tenants = await Tenant.find({ estate: estate._id, status: 'occupied' });

    const occupiedCount = units.filter(u => u.status === 'occupied').length;
    const vacantCount = units.filter(u => u.status === 'vacant').length;

    // Calculate revenue and pending for this estate
    const payments = await Payment.find({
      estate: estate._id,
      paymentStatus: 'completed'
    });

    const billingItems = await BillingItem.find({
      estate: estate._id,
      isActive: true,
      isPaid: false
    });

    const estateRevenue = payments.reduce((sum, p) => sum + p.amount, 0);
    const estatePending = billingItems.reduce((sum, b) => sum + b.amount, 0);

    overview.estates.push({
      id: estate._id,
      name: estate.name,
      address: estate.address,
      totalUnits: units.length,
      occupiedUnits: occupiedCount,
      vacantUnits: vacantCount,
      totalTenants: tenants.length,
      revenue: estateRevenue,
      pendingPayments: estatePending
    });

    overview.statistics.totalUnits += units.length;
    overview.statistics.occupiedUnits += occupiedCount;
    overview.statistics.vacantUnits += vacantCount;
    overview.statistics.totalTenants += tenants.length;
    overview.statistics.totalRevenueGenerated += estateRevenue;
    overview.statistics.pendingPayments += estatePending;
    overview.statistics.unpaidBills += billingItems.length;
  }

  // Recent payments across all estates
  const recentPayments = await Payment.find({
    estate: { $in: estateIds },
    paymentStatus: 'completed'
  })
    .populate('tenant', 'tenantName')
    .sort({ createdAt: -1 })
    .limit(10);

  overview.recentPayments = recentPayments.map(p => ({
    id: p._id,
    tenantName: p.tenant?.tenantName || 'Unknown',
    amount: p.amount,
    paymentType: p.paymentType,
    date: p.createdAt
  }));

  // Calculate occupancy percentage
  if (overview.statistics.totalUnits > 0) {
    overview.statistics.occupancyRate = Math.round(
      (overview.statistics.occupiedUnits / overview.statistics.totalUnits) * 100
    );
  } else {
    overview.statistics.occupancyRate = 0;
  }

  return overview;
};

/**
 * VENDOR OVERVIEW
 * Shows assigned work, service requests, earnings
 */
const getVendorOverview = async (userId) => {
  const user = await User.findById(userId);
  if (!user) throw new Error('User not found');

  const overview = {
    section: 'VENDOR_OVERVIEW',
    businessInfo: {
      businessName: user.businessName,
      specialization: user.specialization,
      businessType: user.businessTypeId
    },
    statistics: {
      totalRequests: 0,
      completedRequests: 0,
      pendingRequests: 0,
      inProgressRequests: 0,
      totalEarnings: 0,
      rating: 0
    },
    recentRequests: [],
    wallet: {}
  };

  // Get service requests for this vendor
  const serviceRequests = await ServiceRequest.find({
    assignedVendor: userId,
    isActive: true
  }).sort({ createdAt: -1 });

  overview.statistics.totalRequests = serviceRequests.length;
  overview.statistics.completedRequests = serviceRequests.filter(r => r.status === 'completed').length;
  overview.statistics.pendingRequests = serviceRequests.filter(r => r.status === 'pending').length;
  overview.statistics.inProgressRequests = serviceRequests.filter(r => r.status === 'in_progress').length;

  // Recent requests
  overview.recentRequests = serviceRequests.slice(0, 10).map(r => ({
    id: r._id,
    title: r.title,
    description: r.description,
    status: r.status,
    priority: r.priority,
    estimatedBudget: r.estimatedBudget,
    createdAt: r.createdAt
  }));

  // Wallet
  const wallet = await Wallet.findOne({ userId });
  if (wallet) {
    overview.wallet = {
      balance: wallet.balance,
      totalEarnings: wallet.totalEarnings,
      currency: wallet.currency
    };
    overview.statistics.totalEarnings = wallet.totalEarnings;
  }

  return overview;
};

/**
 * MANAGER OVERVIEW
 * Shows managed properties, staff, operations
 */
const getManagerOverview = async (userId) => {
  const overview = {
    section: 'MANAGER_OVERVIEW',
    statistics: {
      assignedEstates: 0,
      assignedStaff: 0,
      tasksDue: 0,
      upcomingInspections: 0
    },
    responsibilities: [],
    tasks: [],
    alerts: []
  };

  // Find user's role-specific data
  // This can be extended based on your manager responsibilities model
  
  return overview;
};

/**
 * SUPER ADMIN OVERVIEW
 * Shows system-wide statistics and health
 */
const getSuperAdminOverview = async () => {
  const overview = {
    section: 'SYSTEM_OVERVIEW',
    statistics: {
      totalUsers: 0,
      totalEstates: 0,
      totalTenants: 0,
      totalUnits: 0,
      systemRevenue: 0,
      activeTransactions: 0
    },
    userDistribution: {},
    recentActivities: [],
    systemHealth: {
      status: 'healthy',
      checks: []
    }
  };

  try {
    // Count users by role
    const userStats = await User.aggregate([
      {
        $group: {
          _id: '$role',
          count: { $sum: 1 }
        }
      }
    ]);

    overview.userDistribution = userStats.reduce((acc, stat) => {
      acc[stat._id] = stat.count;
      return acc;
    }, {});

    overview.statistics.totalUsers = userStats.reduce((sum, stat) => sum + stat.count, 0);
    overview.statistics.totalEstates = await Estate.countDocuments({ isActive: true });
    overview.statistics.totalTenants = await Tenant.countDocuments({ status: 'occupied' });
    overview.statistics.totalUnits = await Unit.countDocuments({ isActive: true });

    // Calculate total revenue
    const revenueData = await Payment.aggregate([
      {
        $match: { paymentStatus: 'completed' }
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$amount' }
        }
      }
    ]);

    overview.statistics.systemRevenue = revenueData.length > 0 ? revenueData[0].total : 0;

    // Count active transactions (unpaid bills)
    overview.statistics.activeTransactions = await BillingItem.countDocuments({
      isPaid: false,
      isActive: true
    });
  } catch (error) {
    logError('Error calculating super admin overview', { error: error.message });
  }

  return overview;
};

module.exports = {
  getOverview,
  getTenantOverview,
  getBusinessOwnerOverview,
  getVendorOverview,
  getManagerOverview,
  getSuperAdminOverview
};
