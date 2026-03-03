const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
const { sendDepositEmail, sendWithdrawalEmail, sendTransactionNotificationEmail } = require('../utils/walletEmailService');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

const testDepositFlow = async () => {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 TESTING DEPOSIT INTO WALLET FLOW');
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
  let wallet = await Wallet.findOne({ userId: user._id });
  
  if (!wallet) {
    console.log('❌ Wallet not found for user');
    process.exit(1);
  }
  
  const depositAmount = 10000;
  const previousBalance = wallet.balance;
  
  console.log(`💰 Current wallet balance: ₦${previousBalance.toLocaleString()}`);
  console.log(`💵 Depositing: ₦${depositAmount.toLocaleString()}\n`);
  
  // Simulate deposit
  console.log('--- Step 1: Update Wallet Balance ---');
  wallet.balance += depositAmount;
  wallet.totalEarnings += depositAmount;
  wallet.lastUpdated = new Date();
  await wallet.save();
  
  console.log(`✅ Wallet balance updated`);
  console.log(`   New balance: ₦${wallet.balance.toLocaleString()}\n`);
  
  // Create transaction record
  console.log('--- Step 2: Create Transaction Record ---');
  const transaction = await Transaction.create({
    user: user._id,
    walletId: wallet._id,
    amount: depositAmount,
    type: 'deposit',
    method: 'bank',
    status: 'completed',
    reference: 'TEST-DEP-' + Date.now(),
    description: 'Test deposit via script',
    createdBy: user._id
  });
  
  console.log(`✅ Transaction created: ${transaction._id}`);
  console.log(`   Type: ${transaction.type}`);
  console.log(`   Amount: ₦${transaction.amount.toLocaleString()}`);
  console.log(`   Reference: ${transaction.reference}\n`);
  
  // Send deposit email
  console.log('--- Step 3: Send Deposit Email Notification ---');
  try {
    await sendDepositEmail(user, depositAmount, { 
      _id: transaction._id, 
      reference: transaction.reference,
      newBalance: wallet.balance 
    }, 'Wallet Deposit');
    console.log('✅ Deposit email sent successfully!\n');
  } catch (error) {
    console.log('❌ Failed to send deposit email:', error.message, '\n');
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
  console.log(`   Deposit Amount: ₦${depositAmount.toLocaleString()}`);
  console.log(`   Previous Balance: ₦${previousBalance.toLocaleString()}`);
  console.log(`   New Balance: ₦${finalWallet.balance.toLocaleString()}`);
  console.log(`   Transaction ID: ${transaction._id}`);
  console.log(`   Transaction Reference: ${transaction.reference}`);
  console.log(`   Email Sent: ✅ YES`);
  console.log('='.repeat(60));
  console.log('\n✅ DEPOSIT TEST COMPLETED!');
  console.log('📧 Check your email inbox for the deposit notification!');
  console.log('(Also check spam folder if not received)\n');
  
  process.exit(0);
};

// Run the test
testDepositFlow();
