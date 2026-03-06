const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const WalletAccount = require('../models/WalletAccount');
const Estate = require('../models/Estate');

const TRANSFER_AMOUNT = 20000;

mongoose.connect(process.env.MONGODB_URI).then(async () => {
  const managers = await User.find({ role: 'manager', isActive: true });
  const vendors = await User.find({ role: 'vendor', isActive: true });
  
  const totalRecipients = managers.length + vendors.length;
  const totalPayout = totalRecipients * TRANSFER_AMOUNT;
  
  const estate = await Estate.findOne({ isActive: true });
  const walletAccount = await WalletAccount.findOne({ estate: estate._id });
  
  const availableBalance = walletAccount.innovationEngineSavingsBalance;
  const shortfall = totalPayout - availableBalance;
  
  console.log('=== MONTHLY PAYOUT SUMMARY ===\n');
  console.log(`Managers: ${managers.length}`);
  console.log(`Vendors: ${vendors.length}`);
  console.log(`Total recipients: ${totalRecipients}`);
  console.log(`Amount per person: ₦${TRANSFER_AMOUNT.toLocaleString()}`);
  console.log(`Total payout: ₦${totalPayout.toLocaleString()}\n`);
  console.log(`Innovation Engine Savings available: ₦${availableBalance.toLocaleString()}`);
  
  if (shortfall > 0) {
    console.log(`⚠️  Shortfall: ₦${shortfall.toLocaleString()}`);
    console.log(`   Proceeding with NEGATIVE balance allowed...\n`);
  }
  
  // Deduct from Innovation Engine Savings (allow negative)
  walletAccount.innovationEngineSavingsBalance -= totalPayout;
  
  // Pay managers
  console.log('=== MANAGERS PAID ===\n');
  for (const m of managers) {
    let wallet = await Wallet.findOne({ userId: m._id });
    if (!wallet) wallet = new Wallet({ userId: m._id });
    wallet.balance += TRANSFER_AMOUNT;
    wallet.totalEarnings += TRANSFER_AMOUNT;
    await wallet.save();
    console.log(`✓ ${m.name} - ₦${TRANSFER_AMOUNT.toLocaleString()}`);
  }
  
  // Pay vendors
  console.log('\n=== VENDORS PAID ===\n');
  for (const v of vendors) {
    let wallet = await Wallet.findOne({ userId: v._id });
    if (!wallet) wallet = new Wallet({ userId: v._id });
    wallet.balance += TRANSFER_AMOUNT;
    wallet.totalEarnings += TRANSFER_AMOUNT;
    await wallet.save();
    console.log(`✓ ${v.name} - ₦${TRANSFER_AMOUNT.toLocaleString()}`);
  }
  
  await walletAccount.save();
  
  console.log('\n=== PAYOUT COMPLETE ===\n');
  console.log(`Total people paid: ${totalRecipients}`);
  console.log(`Total paid: ₦${totalPayout.toLocaleString()}`);
  console.log(`Remaining Innovation Savings: ₦${walletAccount.innovationEngineSavingsBalance.toLocaleString()}`);
  
  if (walletAccount.innovationEngineSavingsBalance < 0) {
    console.log(`⚠️  NOTE: Account is in NEGATIVE (DEBT): ₦${Math.abs(walletAccount.innovationEngineSavingsBalance).toLocaleString()}`);
  }
  
  await mongoose.disconnect();
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
