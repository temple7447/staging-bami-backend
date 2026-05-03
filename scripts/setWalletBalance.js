const mongoose = require('mongoose');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const Transaction = require('../models/Transaction');
require('dotenv').config();

async function setWalletBalance() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected to MongoDB');

    const email = 'tenant@test.com';
    const targetBalance = 50000;

    const user = await User.findOne({ email });
    if (!user) {
      console.log(`User with email ${email} not found`);
      process.exit(1);
    }

    let wallet = await Wallet.findOne({ userId: user._id });
    if (!wallet) {
      wallet = new Wallet({
        userId: user._id,
        balance: 0,
        currency: 'NGN',
        totalEarnings: 0,
        totalSpent: 0
      });
    }

    // Clear transaction history
    const deletedTransactions = await Transaction.deleteMany({ user: user._id });
    console.log(`Cleared ${deletedTransactions.deletedCount} transactions for ${email}`);

    // Clear wallet transaction references
    wallet.transactions = [];
    wallet.totalEarnings = 0;
    wallet.totalSpent = 0;

    // Set new balance
    wallet.balance = targetBalance;
    wallet.lastUpdated = new Date();

    await wallet.save();
    console.log(`Wallet balance for ${email} set to ${targetBalance} NGN`);
    console.log('Transaction history cleared');

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  }
}

setWalletBalance();
