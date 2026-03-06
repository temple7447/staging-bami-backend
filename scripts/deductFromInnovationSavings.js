const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const WalletAccount = require('../models/WalletAccount');
const Estate = require('../models/Estate');

const MONGO_URI = process.env.MONGODB_URI;
const TRANSFER_AMOUNT = 20000;

async function deductFromInnovationSavings() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB\n');

    // Get 3 managers
    const managers = await User.find({ role: 'manager', isActive: true }).limit(3);
    console.log(`Found ${managers.length} managers`);

    // Get 3 vendors
    const vendors = await User.find({ role: 'vendor', isActive: true }).limit(3);
    console.log(`Found ${vendors.length} vendors`);

    const totalDeduction = (managers.length + vendors.length) * TRANSFER_AMOUNT;
    console.log(`\n=== REVERSING TRANSFERS ===`);
    console.log(`Deducting ₦${TRANSFER_AMOUNT.toLocaleString()} from each manager/vendor wallet...\n`);

    // Deduct from managers
    console.log('=== MANAGERS (Deducting) ===');
    for (const manager of managers) {
      const wallet = await Wallet.findOne({ userId: manager._id });
      if (wallet) {
        wallet.balance -= TRANSFER_AMOUNT;
        wallet.totalEarnings -= TRANSFER_AMOUNT;
        await wallet.save();
        console.log(`✓ ${manager.name}: ₦${wallet.balance.toLocaleString()}`);
      }
    }

    // Deduct from vendors
    console.log('\n=== VENDORS (Deducting) ===');
    for (const vendor of vendors) {
      const wallet = await Wallet.findOne({ userId: vendor._id });
      if (wallet) {
        wallet.balance -= TRANSFER_AMOUNT;
        wallet.totalEarnings -= TRANSFER_AMOUNT;
        await wallet.save();
        console.log(`✓ ${vendor.name}: ₦${wallet.balance.toLocaleString()}`);
      }
    }

    // Get an estate and add to Innovation Engine Savings
    const estate = await Estate.findOne({ isActive: true });
    
    if (estate) {
      let walletAccount = await WalletAccount.findOne({ estate: estate._id });
      
      if (!walletAccount) {
        walletAccount = new WalletAccount({ estate: estate._id });
      }
      
      // Add to Innovation Engine Savings
      walletAccount.innovationEngineSavingsBalance += totalDeduction;
      await walletAccount.save();
      
      console.log(`\n=== INNOVATION ENGINE SAVINGS (Adding) ===`);
      console.log(`Estate: ${estate.name}`);
      console.log(`Added: ₦${totalDeduction.toLocaleString()}`);
      console.log(`New Innovation Engine Savings Balance: ₦${walletAccount.innovationEngineSavingsBalance.toLocaleString()}`);
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Total deducted from managers/vendors: ₦${totalDeduction.toLocaleString()}`);
    console.log(`Total added to Innovation Engine Savings: ₦${totalDeduction.toLocaleString()}`);
    console.log(`Source: Innovation Engine (4%) wallet`);

    await mongoose.disconnect();
    console.log('\nDone!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

deductFromInnovationSavings();
