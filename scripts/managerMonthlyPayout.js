const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const WalletAccount = require('../models/WalletAccount');
const Estate = require('../models/Estate');

const MONGO_URI = process.env.MONGODB_URI;
const TRANSFER_AMOUNT = 20000;
const NUMBER_OF_MANAGERS = 4;

async function transferMonthlyPayoutToManagers() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB\n');

    // Get 4 managers
    const managers = await User.find({ role: 'manager', isActive: true }).limit(NUMBER_OF_MANAGERS);
    console.log(`Found ${managers.length} managers for payout\n`);

    // Get estate for Innovation Engine Savings
    const estate = await Estate.findOne({ isActive: true });
    const walletAccount = await WalletAccount.findOne({ estate: estate._id });

    console.log(`Current Innovation Engine Savings: ₦${walletAccount.innovationEngineSavingsBalance.toLocaleString()}\n`);

    const totalPayout = managers.length * TRANSFER_AMOUNT;

    if (walletAccount.innovationEngineSavingsBalance < totalPayout) {
      console.log(`Error: Insufficient funds in Innovation Engine Savings`);
      console.log(`Required: ₦${totalPayout.toLocaleString()}`);
      console.log(`Available: ₦${walletAccount.innovationEngineSavingsBalance.toLocaleString()}`);
      await mongoose.disconnect();
      return;
    }

    // Deduct from Innovation Engine Savings
    walletAccount.innovationEngineSavingsBalance -= totalPayout;
    await walletAccount.save();

    console.log(`=== MONTHLY PAYOUT TO MANAGERS ===\n`);
    console.log(`Deducted from Innovation Engine Savings: ₦${totalPayout.toLocaleString()}\n`);

    // Transfer to managers
    console.log('Managers receiving payment:');
    for (const manager of managers) {
      let wallet = await Wallet.findOne({ userId: manager._id });
      
      if (!wallet) {
        wallet = new Wallet({ userId: manager._id, balance: 0 });
      }
      
      wallet.balance += TRANSFER_AMOUNT;
      wallet.totalEarnings += TRANSFER_AMOUNT;
      await wallet.save();
      
      console.log(`✓ ${manager.name} - ₦${TRANSFER_AMOUNT.toLocaleString()}`);
    }

    console.log(`\n=== SUMMARY ===`);
    console.log(`Total managers paid: ${managers.length}`);
    console.log(`Amount per manager: ₦${TRANSFER_AMOUNT.toLocaleString()}`);
    console.log(`Total paid out: ₦${totalPayout.toLocaleString()}`);
    console.log(`Source: Innovation Engine Savings (4%)`);
    console.log(`Remaining Innovation Engine Savings: ₦${walletAccount.innovationEngineSavingsBalance.toLocaleString()}`);

    await mongoose.disconnect();
    console.log('\nPayout complete!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

transferMonthlyPayoutToManagers();
