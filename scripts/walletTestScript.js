const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
require('../models/Estate'); // Ensure Estate model is loaded for population

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

const createWalletsForAllUsers = async () => {
  console.log('\n📋 Checking and creating wallets for all users...\n');
  
  const users = await User.find({});
  console.log(`Total users found: ${users.length}`);
  
  let walletsCreated = 0;
  let walletsAlreadyExist = 0;
  
  for (const user of users) {
    const existingWallet = await Wallet.findOne({ userId: user._id });
    
    if (!existingWallet) {
      const wallet = await Wallet.create({
        userId: user._id,
        balance: 0,
        currency: 'NGN',
        totalEarnings: 0,
        totalSpent: 0,
        isActive: true
      });
      walletsCreated++;
      console.log(`  ✅ Created wallet for: ${user.name} (${user.role}) - ${user.email}`);
    } else {
      walletsAlreadyExist++;
      console.log(`  ⚪ Wallet exists for: ${user.name} (${user.role}) - ${user.email}`);
    }
  }
  
  console.log(`\n📊 Summary:`);
  console.log(`   - Total users: ${users.length}`);
  console.log(`   - Wallets created: ${walletsCreated}`);
  console.log(`   - Wallets already existed: ${walletsAlreadyExist}`);
  
  return { users, walletsCreated, walletsAlreadyExist };
};

const displayWalletSummary = async () => {
  console.log('\n📊 Wallet Summary:\n');
  
  const wallets = await Wallet.find({}).populate('userId', 'name email role');
  
  console.log('| No | Name | Email | Role | Balance | Total Earnings | Total Spent |');
  console.log('|---|---|---|---|---|---|---|');
  
  wallets.forEach((wallet, index) => {
    const user = wallet.userId;
    const name = user ? user.name : 'Unknown';
    const email = user ? user.email : 'Unknown';
    const role = user ? user.role : 'Unknown';
    console.log(`| ${index + 1} | ${name} | ${email} | ${role} | ₦${wallet.balance.toLocaleString()} | ₦${wallet.totalEarnings.toLocaleString()} | ₦${wallet.totalSpent.toLocaleString()} |`);
  });
  
  console.log(`\nTotal wallets: ${wallets.length}`);
  
  const totalBalance = wallets.reduce((sum, w) => sum + w.balance, 0);
  const totalEarnings = wallets.reduce((sum, w) => sum + w.totalEarnings, 0);
  const totalSpent = wallets.reduce((sum, w) => sum + w.totalSpent, 0);
  
  console.log(`Total balance across all wallets: ₦${totalBalance.toLocaleString()}`);
  console.log(`Total earnings across all wallets: ₦${totalEarnings.toLocaleString()}`);
  console.log(`Total spent across all wallets: ₦${totalSpent.toLocaleString()}`);
};

const displayTransactionSummary = async () => {
  console.log('\n📊 Transaction Summary:\n');
  
  const transactions = await Transaction.find({})
    .populate('user', 'name email role')
    .populate('estate', 'name')
    .sort({ createdAt: -1 })
    .limit(20);
  
  console.log(`Recent transactions (last 20):\n`);
  
  transactions.forEach((tx) => {
    const user = tx.user;
    const name = user ? user.name : 'Unknown';
    const estate = tx.estate ? tx.estate.name : 'N/A';
    console.log(`  - ${tx.type.toUpperCase()} | ₦${tx.amount.toLocaleString()} | ${name} | ${estate} | ${tx.status} | ${new Date(tx.createdAt).toLocaleDateString()}`);
  });
  
  const totalTransactions = await Transaction.countDocuments();
  console.log(`\nTotal transactions in system: ${totalTransactions}`);
};

const runFullTest = async () => {
  console.log('='.repeat(60));
  console.log('🧪 WALLET & TRANSACTION SYSTEM TEST');
  console.log('='.repeat(60));
  
  await connectDB();
  
  // Step 1: Create wallets for all users
  await createWalletsForAllUsers();
  
  // Step 2: Display wallet summary
  await displayWalletSummary();
  
  // Step 3: Display transaction summary
  await displayTransactionSummary();
  
  console.log('\n' + '='.repeat(60));
  console.log('✅ TEST COMPLETED');
  console.log('='.repeat(60));
  
  process.exit(0);
};

runFullTest();
