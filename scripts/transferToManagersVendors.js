const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Wallet = require('../models/Wallet');

const MONGO_URI = process.env.MONGODB_URI;
const TRANSFER_AMOUNT = 20000;

async function transferToManagersAndVendors() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB\n');

    // Get 3 managers
    const managers = await User.find({ role: 'manager', isActive: true }).limit(3);
    console.log(`Found ${managers.length} managers`);

    // Get 3 vendors
    const vendors = await User.find({ role: 'vendor', isActive: true }).limit(3);
    console.log(`Found ${vendors.length} vendors`);

    console.log(`\nTransferring ₦${TRANSFER_AMOUNT.toLocaleString()} to each...\n`);

    // Transfer to managers
    console.log('=== MANAGERS ===');
    for (const manager of managers) {
      let wallet = await Wallet.findOne({ userId: manager._id });
      
      if (!wallet) {
        wallet = new Wallet({ userId: manager._id, balance: 0 });
      }
      
      wallet.balance += TRANSFER_AMOUNT;
      wallet.totalEarnings += TRANSFER_AMOUNT;
      await wallet.save();
      
      console.log(`✓ ${manager.name} (${manager.email})`);
      console.log(`  New balance: ₦${wallet.balance.toLocaleString()}`);
    }

    // Transfer to vendors
    console.log('\n=== VENDORS ===');
    for (const vendor of vendors) {
      let wallet = await Wallet.findOne({ userId: vendor._id });
      
      if (!wallet) {
        wallet = new Wallet({ userId: vendor._id, balance: 0 });
      }
      
      wallet.balance += TRANSFER_AMOUNT;
      wallet.totalEarnings += TRANSFER_AMOUNT;
      await wallet.save();
      
      console.log(`✓ ${vendor.name} (${vendor.email})`);
      console.log(`  New balance: ₦${wallet.balance.toLocaleString()}`);
    }

    console.log('\n=== SUMMARY ===');
    console.log(`Total transferred: ₦${((managers.length + vendors.length) * TRANSFER_AMOUNT).toLocaleString()}`);

    await mongoose.disconnect();
    console.log('\nTransfer complete!');
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

transferToManagersAndVendors();
