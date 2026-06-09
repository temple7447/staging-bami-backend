require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');

const connectDatabase = require(path.join(__dirname, '../config/database'));
const User = require(path.join(__dirname, '../models/User'));
const Tenant = require(path.join(__dirname, '../models/Tenant'));
const Payment = require(path.join(__dirname, '../models/Payment'));
const BillingItem = require(path.join(__dirname, '../models/BillingItem'));
const Transaction = require(path.join(__dirname, '../models/Transaction'));
const Wallet = require(path.join(__dirname, '../models/Wallet'));

async function clearTenantPayments() {
  await connectDatabase();

  console.log('Clearing payment records for tenant@test.com...\n');

  // Find the user
  const user = await User.findOne({ email: 'tenant@test.com' });
  if (!user) {
    console.error('User tenant@test.com not found');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log('Found user:', user.email, `(${user._id})`);

  // Find the tenant record
  const tenant = await Tenant.findOne({ user: user._id, isActive: true });
  if (!tenant) {
    console.error('No active tenant record found for this user');
    await mongoose.disconnect();
    process.exit(1);
  }
  console.log('Found tenant:', tenant.tenantName, `(${tenant._id})`);

  // Delete all payments for this tenant
  const deletedPayments = await Payment.deleteMany({ tenant: tenant._id });
  console.log(`Deleted ${deletedPayments.deletedCount} payment records`);

  // Delete all billing items for this tenant
  const deletedBillingItems = await BillingItem.deleteMany({ tenant: tenant._id });
  console.log(`Deleted ${deletedBillingItems.deletedCount} billing items`);

  // Delete all transactions for this tenant
  const deletedTransactions = await Transaction.deleteMany({ tenant: tenant._id });
  console.log(`Deleted ${deletedTransactions.deletedCount} transaction records`);

  // Reset user's wallet
  const wallet = await Wallet.findOne({ userId: user._id });
  if (wallet) {
    wallet.balance = 0;
    wallet.totalEarnings = 0;
    wallet.totalSpent = 0;
    wallet.transactions = [];
    wallet.lastUpdated = new Date();
    await wallet.save();
    console.log('Reset user wallet balance to 0');
  }

  // Reset tenant to just-moved-in state (today's date, no payments)
  const today = new Date();
  tenant.entryDate = today;
  tenant.nextDueDate = null;
  await tenant.save();
  console.log('Set entryDate to today, nextDueDate to null');

  console.log('\nSummary:');
  console.log('  All payment records cleared for tenant:', tenant.tenantName);
  console.log('  Entry date set to today:', today.toISOString().split('T')[0]);
  console.log('  Wallet reset to 0');
  console.log('  The tenant now appears as a new tenant with no payment history');

  await mongoose.disconnect();
  console.log('\nPayment clearing completed!');
  process.exit(0);
}

clearTenantPayments().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
