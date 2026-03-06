const mongoose = require('mongoose');
require('dotenv').config();

const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const WalletAccount = require('../models/WalletAccount');
const Payment = require('../models/Payment');
const { distributePayment } = require('../utils/distributionService');

const MONGO_URI = process.env.MONGODB_URI;

async function testDistribution() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB\n');

    // Get a tenant
    const tenant = await Tenant.findOne({ isActive: true }).populate('estate');
    if (!tenant) {
      console.log('No active tenant found');
      return;
    }

    // Get an admin user for createdBy/admin
    const User = require('../models/User');
    const admin = await User.findOne({ role: 'super_admin' }) || await User.findOne({ role: 'admin' });
    if (!admin) {
      console.log('No admin found');
      return;
    }

    console.log(`Testing with Tenant: ${tenant.tenantName}`);
    console.log(`Estate: ${tenant.estate.name}\n`);

    const amount = 1000000;
    console.log(`Making payment of ₦${amount.toLocaleString()}\n`);

    // Create a mock payment
    const payment = new Payment({
      user: tenant.user || admin._id,
      tenant: tenant._id,
      estate: tenant.estate._id,
      admin: admin._id,
      createdBy: admin._id,
      paymentType: 'rent',
      amount: amount,
      currency: 'NGN',
      paymentStatus: 'completed',
      paymentMethod: 'cash'
    });
    await payment.save();

    // Distribute the payment
    const result = await distributePayment(tenant.estate._id, amount, payment._id, 'rent');

    console.log('=== DISTRIBUTION BREAKDOWN ===\n');
    console.log(`Total Payment: ₦${amount.toLocaleString()}\n`);

    console.log('GROWTH ENGINE (50% = ₦500,000)');
    console.log(`  ├─ Marketing (A-50% = 25%): ₦${result.distribution.growthEngine.marketing.toLocaleString()}`);
    console.log(`  ├─ Operations (A-30% = 15%): ₦${result.distribution.growthEngine.operations.toLocaleString()}`);
    console.log(`  └─ Savings (A-20% = 10%): ₦${result.distribution.growthEngine.savings.toLocaleString()}`);
    console.log(`     Total: ₦${result.distribution.growthEngine.total.toLocaleString()}\n`);

    console.log('FULFILLMENT ENGINE (30% = ₦300,000)');
    console.log(`  ├─ Marketing (B-50% = 15%): ₦${result.distribution.fulfillmentEngine.marketing.toLocaleString()}`);
    console.log(`  ├─ Operations (B-30% = 9%): ₦${result.distribution.fulfillmentEngine.operations.toLocaleString()}`);
    console.log(`  └─ Family Savings (B-20% = 6%): ₦${result.distribution.fulfillmentEngine.savings.toLocaleString()}`);
    console.log(`     Total: ₦${result.distribution.fulfillmentEngine.total.toLocaleString()}\n`);

    console.log('INNOVATION ENGINE (20% = ₦200,000)');
    console.log(`  ├─ Marketing (C-50% = 10%): ₦${result.distribution.innovationEngine.marketing.toLocaleString()}`);
    console.log(`  ├─ Operations (C-30% = 6%): ₦${result.distribution.innovationEngine.operations.toLocaleString()}`);
    console.log(`  └─ Savings (C-20% = 4%): ₦${result.distribution.innovationEngine.savings.toLocaleString()}`);
    console.log(`     Total: ₦${result.distribution.innovationEngine.total.toLocaleString()}\n`);

    console.log('=== WALLET BALANCES AFTER PAYMENT ===\n');
    const wallet = await WalletAccount.findOne({ estate: tenant.estate._id });
    console.log('Growth Engine:');
    console.log(`  Marketing: ₦${wallet.growthEngineMarketingBalance.toLocaleString()}`);
    console.log(`  Operations: ₦${wallet.growthEngineOperationsBalance.toLocaleString()}`);
    console.log(`  Savings: ₦${wallet.growthEngineSavingsBalance.toLocaleString()}`);

    console.log('\nFulfillment Engine:');
    console.log(`  Marketing: ₦${wallet.fulfillmentEngineMarketingBalance.toLocaleString()}`);
    console.log(`  Operations: ₦${wallet.fulfillmentEngineOperationsBalance.toLocaleString()}`);
    console.log(`  Family Savings: ₦${wallet.fulfillmentEngineSavingsBalance.toLocaleString()}`);

    console.log('\nInnovation Engine:');
    console.log(`  Marketing: ₦${wallet.innovationEngineMarketingBalance.toLocaleString()}`);
    console.log(`  Operations: ₦${wallet.innovationEngineOperationsBalance.toLocaleString()}`);
    console.log(`  Savings: ₦${wallet.innovationEngineSavingsBalance.toLocaleString()}`);

    console.log(`\nTotal Balance: ₦${wallet.totalBalance.toLocaleString()}`);
    console.log(`Total Received: ₦${wallet.totalReceived.toLocaleString()}`);

    await mongoose.disconnect();
    console.log('\nTest complete!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

testDistribution();
