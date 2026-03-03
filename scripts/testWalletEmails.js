const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const { sendWalletCreatedEmail, sendDepositEmail, sendWithdrawalEmail, sendWalletPayoutEmail } = require('../utils/walletEmailService');

const connectDB = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✅ MongoDB Connected');
  } catch (error) {
    console.error('❌ MongoDB Connection Error:', error.message);
    process.exit(1);
  }
};

const testEmailService = async () => {
  console.log('\n' + '='.repeat(60));
  console.log('🧪 TESTING WALLET EMAIL NOTIFICATIONS');
  console.log('='.repeat(60) + '\n');
  
  await connectDB();
  
  // Get a test user
  const user = await User.findOne({ email: 'templevoke@gmail.com' });
  
  if (!user) {
    console.log('❌ Test user not found');
    process.exit(1);
  }
  
  console.log(`📧 Test user: ${user.name} (${user.email})\n`);
  
  // Test 1: Wallet Created Email
  console.log('--- Test 1: Wallet Created Email ---');
  try {
    await sendWalletCreatedEmail(user);
    console.log('✅ Wallet created email sent successfully\n');
  } catch (error) {
    console.log('❌ Failed:', error.message, '\n');
  }
  
  // Test 2: Deposit Email
  console.log('--- Test 2: Deposit Email ---');
  try {
    await sendDepositEmail(user, 5000, { _id: 'TEST-001', newBalance: 48000 }, 'Test Deposit');
    console.log('✅ Deposit email sent successfully\n');
  } catch (error) {
    console.log('❌ Failed:', error.message, '\n');
  }
  
  // Test 3: Withdrawal Email
  console.log('--- Test 3: Withdrawal Email ---');
  try {
    await sendWithdrawalEmail(user, 2000, { _id: 'TEST-002', newBalance: 46000 }, {
      bankName: 'First Bank',
      accountNumber: '1234567890',
      accountName: user.name
    });
    console.log('✅ Withdrawal email sent successfully\n');
  } catch (error) {
    console.log('❌ Failed:', error.message, '\n');
  }
  
  // Test 4: Payout Email
  console.log('--- Test 4: Payout Email ---');
  try {
    await sendWalletPayoutEmail(user, 20000, 'BALADO RESIDENCE', 'payout');
    console.log('✅ Payout email sent successfully\n');
  } catch (error) {
    console.log('❌ Failed:', error.message, '\n');
  }
  
  console.log('='.repeat(60));
  console.log('✅ EMAIL TESTS COMPLETED');
  console.log('='.repeat(60));
  console.log('\n📧 Check your email inbox for the test messages!');
  console.log('(Also check spam folder if not received)\n');
  
  process.exit(0);
};

testEmailService();
