/**
 * Hard-delete all data for a specific user by email.
 * Run: node scripts/deleteUser.js starukido@gmail.com
 */
require('dotenv').config();
const mongoose = require('mongoose');

const User = require('../models/User');
const Tenant = require('../models/Tenant');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const Payment = require('../models/Payment');
const Notification = require('../models/Notification');
const Withdrawal = require('../models/Withdrawal');
const ReminderLog = require('../models/ReminderLog');
const Issue = require('../models/Issue');

const targetEmail = process.argv[2];
if (!targetEmail) {
  console.error('Usage: node scripts/deleteUser.js <email>');
  process.exit(1);
}

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB\n');

  // 1. Find the user
  const user = await User.findOne({ email: targetEmail.toLowerCase().trim() });
  if (!user) {
    console.log(`No user found with email: ${targetEmail}`);
    process.exit(0);
  }
  const userId = user._id;
  console.log(`Found user: ${user.name} (${user.email}) — ID: ${userId}\n`);

  // 2. Find tenant records linked to this user
  const tenants = await Tenant.find({ user: userId });
  const tenantIds = tenants.map(t => t._id);
  console.log(`Tenants linked: ${tenantIds.length}`);

  // 3. Delete ReminderLogs for tenants
  const reminderResult = await ReminderLog.deleteMany({ tenant: { $in: tenantIds } });
  console.log(`ReminderLogs deleted: ${reminderResult.deletedCount}`);

  // 4. Delete Issues for tenants
  const issueResult = await Issue.deleteMany({ tenant: { $in: tenantIds } });
  console.log(`Issues deleted: ${issueResult.deletedCount}`);

  // 5. Delete Payments for user or tenant
  const paymentResult = await Payment.deleteMany({
    $or: [{ user: userId }, { tenant: { $in: tenantIds } }]
  });
  console.log(`Payments deleted: ${paymentResult.deletedCount}`);

  // 6. Delete Transactions for user
  const txResult = await Transaction.deleteMany({ user: userId });
  console.log(`Transactions deleted: ${txResult.deletedCount}`);

  // 7. Delete Wallet(s) for user
  const walletResult = await Wallet.deleteMany({ userId });
  console.log(`Wallets deleted: ${walletResult.deletedCount}`);

  // 8. Delete Withdrawals for user
  const withdrawalResult = await Withdrawal.deleteMany({ user: userId });
  console.log(`Withdrawals deleted: ${withdrawalResult.deletedCount}`);

  // 9. Delete Notifications for user
  const notifResult = await Notification.deleteMany({ user: userId });
  console.log(`Notifications deleted: ${notifResult.deletedCount}`);

  // 10. Delete Tenant records
  const tenantResult = await Tenant.deleteMany({ user: userId });
  console.log(`Tenant records deleted: ${tenantResult.deletedCount}`);

  // 11. Delete the User
  await User.deleteOne({ _id: userId });
  console.log(`\nUser "${user.name}" (${user.email}) permanently deleted.`);

  await mongoose.disconnect();
}

run().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
