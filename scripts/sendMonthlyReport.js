const mongoose = require('mongoose');
require('dotenv').config();

// Load all models first
require('../models/User');
require('../models/Estate');
require('../models/Unit');
require('../models/Tenant');
require('../models/Payment');
require('../models/WalletAccount');

const User = require('../models/User');
const { generateMonthlyReport, sendMonthlyReportEmail } = require('../utils/monthlyReportService');

async function sendReportToAllAdmins() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI || process.env.MONGO_URI);
    console.log('✅ Connected to MongoDB');

    // Get all admin users
    const admins = await User.find({
      role: { $in: ['admin', 'super_admin'] },
      isActive: true
    }).select('email name');

    if (admins.length === 0) {
      console.log('❌ No active admin users found');
      process.exit(1);
    }

    const adminEmails = admins.map(a => a.email);
    console.log(`📋 Found ${admins.length} admin(s): ${adminEmails.join(', ')}`);
    
    // Generate report
    console.log(`\n📧 Generating monthly report...`);
    const report = await generateMonthlyReport(new Date());
    
    if (!report) {
      console.log('❌ No tenants found');
      process.exit(1);
    }

    console.log(`📊 Report generated:`);
    console.log(`   - Total tenants: ${report.summary.totalTenants}`);
    console.log(`   - Occupied: ${report.summary.occupiedTenants}`);
    console.log(`   - Total paid this month: ₦${report.summary.totalPaidThisMonth.toLocaleString()}`);
    console.log(`   - Total outstanding: ₦${report.summary.totalOutstanding.toLocaleString()}`);

    // Send email to each admin
    for (const admin of admins) {
      console.log(`\n📧 Sending to: ${admin.email}...`);
      await sendMonthlyReportEmail(report, admin.email);
      console.log(`   ✅ Sent to ${admin.email}`);
    }
    
    console.log(`\n✅ Report sent successfully to ${admins.length} admin(s)!`);
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  } finally {
    await mongoose.disconnect();
    console.log('🔌 Disconnected from MongoDB');
    process.exit(0);
  }
}

sendReportToAllAdmins();
