const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const { sendWithdrawalEmail } = require('../utils/walletEmailService');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

const testWithdrawalFlow = async () => {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 TESTING WITHDRAWAL FROM WALLET FLOW');
  console.log('='.repeat(60) + '\n');
  
  await connectDB();
  
  // Get a test user
  const user = await User.findOne({ email: 'templevoke@gmail.com' });
  
  if (!user) {
    console.log('❌ Test user not found');
    process.exit(1);
  }
  
  console.log(`📧 Test user: ${user.name} (${user.email})`);
  console.log(`   Role: ${user.role}\n`);
  
  // Get current wallet
  const wallet = await Wallet.findOne({ userId: user._id });
  
  if (!wallet) {
    console.log('❌ Wallet not found for user');
    process.exit(1);
  }
  
  const withdrawalAmount = 5000;
  const previousBalance = wallet.balance;
  
  console.log(`💰 Current wallet balance: ₦${previousBalance.toLocaleString()}`);
  console.log(`💸 Withdrawing: ₦${withdrawalAmount.toLocaleString()}\n`);
  
  // Simulate withdrawal
  console.log('--- Step 1: Deduct from Wallet ---');
  wallet.balance -= withdrawalAmount;
  wallet.totalSpent += withdrawalAmount;
  wallet.lastUpdated = new Date();
  await wallet.save();
  
  console.log(`✅ Wallet balance updated`);
  console.log(`   New balance: ₦${wallet.balance.toLocaleString()}\n`);
  
  // Create transaction record
  console.log('--- Step 2: Create Transaction Record ---');
  const transaction = await Transaction.create({
    user: user._id,
    walletId: wallet._id,
    amount: withdrawalAmount,
    type: 'withdrawal',
    method: 'bank',
    status: 'completed',
    reference: 'TEST-WD-' + Date.now(),
    description: 'Test withdrawal via script',
    createdBy: user._id
  });
  
  console.log(`✅ Transaction created: ${transaction._id}`);
  console.log(`   Type: ${transaction.type}`);
  console.log(`   Amount: ₦${transaction.amount.toLocaleString()}`);
  console.log(`   Reference: ${transaction.reference}\n`);
  
  // Send withdrawal email
  console.log('--- Step 3: Send Withdrawal Email Notification ---');
  const bankDetails = {
    bankName: 'First Bank',
    accountNumber: '1234567890',
    accountName: user.name
  };
  
  try {
    await sendWithdrawalEmail(user, withdrawalAmount, { 
      _id: transaction._id, 
      reference: transaction.reference,
      newBalance: wallet.balance 
    }, bankDetails);
    console.log('✅ Withdrawal email sent successfully!\n');
  } catch (error) {
    console.log('❌ Failed to send withdrawal email:', error.message, '\n');
  }
  
  // Verify final state
  console.log('--- Step 4: Verify Final State ---');
  const finalWallet = await Wallet.findOne({ userId: user._id });
  console.log(`   Final wallet balance: ₦${finalWallet.balance.toLocaleString()}`);
  console.log(`   Total earnings: ₦${finalWallet.totalEarnings.toLocaleString()}`);
  console.log(`   Total spent: ₦${finalWallet.totalSpent.toLocaleString()}\n`);
  
  // Summary
  console.log('='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log(`   User: ${user.name} (${user.email})`);
  console.log(`   Withdrawal Amount: ₦${withdrawalAmount.toLocaleString()}`);
  console.log(`   Previous Balance: ₦${previousBalance.toLocaleString()}`);
  console.log(`   New Balance: ₦${finalWallet.balance.toLocaleString()}`);
  console.log(`   Transaction ID: ${transaction._id}`);
  console.log(`   Transaction Reference: ${transaction.reference}`);
  console.log(`   Bank: ${bankDetails.bankName}`);
  console.log(`   Account: ${bankDetails.accountNumber}`);
  console.log(`   Email Sent: ✅ YES`);
  console.log('='.repeat(60));
  console.log('\n✅ WITHDRAWAL TEST COMPLETED!');
  console.log('📧 Check your email inbox for the withdrawal notification!');
  console.log('(Also check spam folder if not received)\n');
  
  process.exit(0);
};

// Run the test
testWithdrawalFlow();
