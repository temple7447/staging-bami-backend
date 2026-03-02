const Tenant = require('../models/Tenant');
const Payment = require('../models/Payment');
const Estate = require('../models/Estate');
const WalletAccount = require('../models/WalletAccount');
const User = require('../models/User');
const { sendEmail } = require('./emailService');
const { logInfo, logError } = require('./logger');

const formatCurrency = (amount) => {
  return new Intl.NumberFormat('en-NG', {
    style: 'currency',
    currency: 'NGN',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  }).format(amount || 0);
};

const generateCSVContent = (data, headers) => {
  const headerRow = headers.join(',');
  const rows = data.map(row => {
    return headers.map(header => {
      let value = row[header] || '';
      if (typeof value === 'string') {
        value = value.replace(/"/g, '""');
        if (value.includes(',') || value.includes('"') || value.includes('\n')) {
          value = `"${value}"`;
        }
      }
      return value;
    }).join(',');
  });
  return [headerRow, ...rows].join('\n');
};

const getMonthYear = (date) => {
  const d = new Date(date);
  const month = d.toLocaleString('en-US', { month: 'long', year: 'numeric' });
  return month;
};

const getPaymentStats = async (tenantId, estateId, targetMonth, targetYear) => {
  const startOfMonth = new Date(targetYear, targetMonth - 1, 1);
  const endOfMonth = new Date(targetYear, targetMonth, 0, 23, 59, 59);

  const payments = await Payment.find({
    tenant: tenantId,
    estate: estateId,
    paymentStatus: 'completed',
    createdAt: { $gte: startOfMonth, $lte: endOfMonth }
  }).sort({ createdAt: -1 });

  const totalPaidThisMonth = payments.reduce((sum, p) => sum + p.amount, 0);
  const lastPayment = payments[0] || null;

  const allPayments = await Payment.find({
    tenant: tenantId,
    estate: estateId,
    paymentStatus: 'completed'
  }).sort({ createdAt: -1 });

  const totalPaidAllTime = allPayments.reduce((sum, p) => sum + p.amount, 0);

  return {
    paymentsThisMonth: payments.length,
    totalPaidThisMonth,
    lastPaymentDate: lastPayment ? new Date(lastPayment.createdAt).toLocaleDateString('en-NG') : 'N/A',
    lastPaymentAmount: lastPayment ? lastPayment.amount : 0,
    totalPaidAllTime,
    paymentMethods: [...new Set(allPayments.map(p => p.paymentMethod))].join(', '),
    transactionIds: allPayments.slice(0, 5).map(p => p.paystackReference || p.transactionId).filter(Boolean).join(', ')
  };
};

const getWalletInfo = async (estateId) => {
  try {
    const wallet = await WalletAccount.findOne({ estate: estateId });
    if (!wallet) {
      return {
        marketingBalance: 0,
        ownerBalance: 0,
        operationsBalance: 0,
        totalReceived: 0
      };
    }
    return {
      marketingBalance: wallet.marketingBalance || 0,
      ownerBalance: wallet.ownerBalance || 0,
      operationsBalance: wallet.operationsBalance || 0,
      totalReceived: wallet.totalReceived || 0
    };
  } catch (error) {
    logError('getWalletInfo', error, { estateId });
    return {
      marketingBalance: 0,
      ownerBalance: 0,
      operationsBalance: 0,
      totalReceived: 0
    };
  }
};

const generateMonthlyReport = async (targetDate = new Date()) => {
  const targetMonth = targetDate.getMonth() + 1;
  const targetYear = targetDate.getFullYear();
  const reportMonth = getMonthYear(targetDate);

  logInfo('Generating monthly tenant report', { month: reportMonth });

  const tenants = await Tenant.find({ isActive: true })
    .populate('estate', 'name slug')
    .populate('unit', 'unitNumber type')
    .sort({ estate: 1, tenantName: 1 });

  if (tenants.length === 0) {
    logInfo('No active tenants found for monthly report');
    return null;
  }

  const estateIds = [...new Set(tenants.map(t => t.estate._id.toString()))];
  const walletsMap = {};

  for (const estateId of estateIds) {
    walletsMap[estateId] = await getWalletInfo(estateId);
  }

  const reportData = [];

  for (const tenant of tenants) {
    const paymentStats = await getPaymentStats(
      tenant._id,
      tenant.estate._id,
      targetMonth,
      targetYear
    );

    const wallet = walletsMap[tenant.estate._id.toString()] || {};

    const outstandingBalance = tenant.rentAmount - paymentStats.totalPaidThisMonth;

    reportData.push({
      estateName: tenant.estate.name || '',
      tenantName: tenant.tenantName || '',
      tenantEmail: tenant.tenantEmail || '',
      tenantPhone: tenant.tenantPhone || '',
      unitLabel: tenant.unitLabel || '',
      unitType: tenant.unit?.type || '',
      status: tenant.status || '',
      tenantType: tenant.tenantType || '',
      entryDate: tenant.entryDate ? new Date(tenant.entryDate).toLocaleDateString('en-NG') : '',
      nextDueDate: tenant.nextDueDate ? new Date(tenant.nextDueDate).toLocaleDateString('en-NG') : '',
      rentAmount: tenant.rentAmount || 0,
      serviceChargeAmount: tenant.serviceChargeAmount || 0,
      electricMeterNumber: tenant.electricMeterNumber || '',
      paymentsThisMonth: paymentStats.paymentsThisMonth,
      totalPaidThisMonth: paymentStats.totalPaidThisMonth,
      lastPaymentDate: paymentStats.lastPaymentDate,
      lastPaymentAmount: paymentStats.lastPaymentAmount,
      totalPaidAllTime: paymentStats.totalPaidAllTime,
      outstandingBalance: outstandingBalance > 0 ? outstandingBalance : 0,
      paymentMethods: paymentStats.paymentMethods,
      transactionIds: paymentStats.transactionIds,
      marketingBalance: wallet.marketingBalance || 0,
      ownerBalance: wallet.ownerBalance || 0,
      operationsBalance: wallet.operationsBalance || 0,
      totalWalletReceived: wallet.totalReceived || 0,
      profileImageUrl: tenant.profileImageUrl || '',
      createdAt: new Date(tenant.createdAt).toLocaleDateString('en-NG'),
      updatedAt: new Date(tenant.updatedAt).toLocaleDateString('en-NG')
    });
  }

  const headers = [
    'estateName',
    'tenantName',
    'tenantEmail',
    'tenantPhone',
    'unitLabel',
    'unitType',
    'status',
    'tenantType',
    'entryDate',
    'nextDueDate',
    'rentAmount',
    'serviceChargeAmount',
    'electricMeterNumber',
    'paymentsThisMonth',
    'totalPaidThisMonth',
    'lastPaymentDate',
    'lastPaymentAmount',
    'totalPaidAllTime',
    'outstandingBalance',
    'paymentMethods',
    'transactionIds',
    'marketingBalance',
    'ownerBalance',
    'operationsBalance',
    'totalWalletReceived',
    'profileImageUrl',
    'createdAt',
    'updatedAt'
  ];

  const csvContent = generateCSVContent(reportData, headers);

  const summary = {
    totalTenants: tenants.length,
    occupiedTenants: tenants.filter(t => t.status === 'occupied').length,
    pendingTenants: tenants.filter(t => t.status === 'pending').length,
    vacantTenants: tenants.filter(t => t.status === 'vacant').length,
    totalRentExpected: tenants.reduce((sum, t) => sum + (t.rentAmount || 0), 0),
    totalPaidThisMonth: reportData.reduce((sum, t) => sum + t.totalPaidThisMonth, 0),
    totalOutstanding: reportData.reduce((sum, t) => sum + t.outstandingBalance, 0),
    totalMarketing: Object.values(walletsMap).reduce((sum, w) => sum + (w.marketingBalance || 0), 0),
    totalOwner: Object.values(walletsMap).reduce((sum, w) => sum + (w.ownerBalance || 0), 0),
    totalOperations: Object.values(walletsMap).reduce((sum, w) => sum + (w.operationsBalance || 0), 0)
  };

  logInfo('Monthly report generated', {
    tenants: summary.totalTenants,
    month: reportMonth
  });

  return {
    csvContent,
    headers,
    reportData,
    summary,
    reportMonth,
    generatedAt: new Date().toISOString()
  };
};

const sendMonthlyReportEmail = async (report, adminEmail) => {
  const { csvContent, summary, reportMonth, generatedAt } = report;

  const message = `
    <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #007bff;">📊 Monthly Tenant Report - ${reportMonth}</h2>
      
      <div style="background-color: #f8f9fa; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">📈 Summary</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Total Tenants:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${summary.totalTenants}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Occupied:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${summary.occupiedTenants}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Pending:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${summary.pendingTenants}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Vacant:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${summary.vacantTenants}</td>
          </tr>
        </table>
      </div>

      <div style="background-color: #e7f3ff; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">💰 Financial Summary (This Month)</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Total Rent Expected:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${formatCurrency(summary.totalRentExpected)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Total Paid:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd; color: green;"><strong>${formatCurrency(summary.totalPaidThisMonth)}</strong></td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Total Outstanding:</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd; color: red;"><strong>${formatCurrency(summary.totalOutstanding)}</strong></td>
          </tr>
        </table>
      </div>

      <div style="background-color: #fff3cd; padding: 20px; border-radius: 5px; margin: 20px 0;">
        <h3 style="margin-top: 0;">🏦 50/30/20 Wallet Distribution (All Time)</h3>
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Marketing (50%):</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${formatCurrency(summary.totalMarketing)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Owner (30%):</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${formatCurrency(summary.totalOwner)}</td>
          </tr>
          <tr>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;"><strong>Operations (20%):</strong></td>
            <td style="padding: 8px; border-bottom: 1px solid #ddd;">${formatCurrency(summary.totalOperations)}</td>
          </tr>
          <tr>
            <td style="padding: 8px;"><strong>Total Received:</strong></td>
            <td style="padding: 8px;"><strong>${formatCurrency(summary.totalMarketing + summary.totalOwner + summary.totalOperations)}</strong></td>
          </tr>
        </table>
      </div>

      <p style="color: #666; font-size: 12px; margin-top: 20px;">
        Generated at: ${new Date(generatedAt).toLocaleString('en-NG')}
      </p>

      <p>Please find the detailed tenant data attached as a CSV file. You can open this file in Excel or Google Sheets.</p>
    </div>
  `;

  const attachments = [
    {
      filename: `BamiHustle_Tenant_Report_${reportMonth.replace(/ /g, '_')}.csv`,
      content: Buffer.from(csvContent, 'utf-8'),
      type: 'text/csv'
    }
  ];

  await sendEmail({
    email: adminEmail,
    subject: `📊 BamiHustle Monthly Tenant Report - ${reportMonth}`,
    html: message,
    attachments
  });

  logInfo('Monthly report email sent', { adminEmail, month: reportMonth });
};

const sendMonthlyReport = async (targetDate = new Date()) => {
  try {
    // Get all admin users from database
    const admins = await User.find({
      role: { $in: ['admin', 'super_admin'] },
      isActive: true
    }).select('email name');

    if (admins.length === 0) {
      logError('sendMonthlyReport', new Error('No active admin users found'));
      return { success: false, error: 'No active admin users found' };
    }

    const adminEmails = admins.map(a => a.email);
    logInfo('Found admins for monthly report', { count: admins.length, emails: adminEmails });
    
    const report = await generateMonthlyReport(targetDate);
    
    if (!report) {
      return { success: true, message: 'No tenants found' };
    }

    // Send to all admins
    for (const admin of admins) {
      await sendMonthlyReportEmail(report, admin.email);
    }

    return {
      success: true,
      month: report.reportMonth,
      summary: report.summary,
      sentTo: adminEmails
    };
  } catch (error) {
    logError('sendMonthlyReport', error);
    return { success: false, error: error.message };
  }
};

const getEstateSummary = async () => {
  const estates = await Estate.find({ isActive: true })
    .populate('createdBy', 'name email')
    .sort({ name: 1 });

  const estateSummaries = [];

  for (const estate of estates) {
    const tenants = await Tenant.find({ estate: estate._id, isActive: true });
    const wallet = await WalletAccount.findOne({ estate: estate._id });

    estateSummaries.push({
      estateName: estate.name,
      totalUnits: estate.totalUnits,
      occupiedUnits: tenants.filter(t => t.status === 'occupied').length,
      pendingUnits: tenants.filter(t => t.status === 'pending').length,
      vacantUnits: estate.totalUnits - (tenants.filter(t => t.status !== 'vacant').length),
      totalRentExpected: tenants.reduce((sum, t) => sum + (t.rentAmount || 0), 0),
      marketingBalance: wallet?.marketingBalance || 0,
      ownerBalance: wallet?.ownerBalance || 0,
      operationsBalance: wallet?.operationsBalance || 0,
      totalReceived: wallet?.totalReceived || 0
    });
  }

  return estateSummaries;
};

module.exports = {
  generateMonthlyReport,
  sendMonthlyReport,
  sendMonthlyReportEmail,
  getEstateSummary
};
