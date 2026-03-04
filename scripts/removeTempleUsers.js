const mongoose = require('mongoose');
require('dotenv').config();

const User = require('../models/User');
const Wallet = require('../models/Wallet');

const MONGO_URI = process.env.MONGODB_URI;

async function removeTempleUsers() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('✅ Connected to MongoDB\n');

    // Find users matching the criteria:
    // 1. Exact email: templetechkz@gmail.com
    // 2. Any user with "temple" in their name or email (case-insensitive)
    const usersToRemove = await User.find({
      $or: [
        { email: 'templetechkz@gmail.com' },
        { email: { $regex: /temple/i } },
        { name: { $regex: /temple/i } }
      ]
    });

    if (usersToRemove.length === 0) {
      console.log('ℹ️  No users found matching "temple" or "templetechkz@gmail.com"');
      await mongoose.disconnect();
      return;
    }

    console.log(`🔍 Found ${usersToRemove.length} user(s) to remove:\n`);
    console.log('─'.repeat(70));

    for (const user of usersToRemove) {
      console.log(`  📧 Email: ${user.email}`);
      console.log(`  👤 Name:  ${user.name}`);
      console.log(`  🏷️  Role:  ${user.role}`);
      console.log(`  🆔 ID:    ${user._id}`);
      console.log('─'.repeat(70));
    }

    console.log('\n🗑️  Removing users and their wallets...\n');

    for (const user of usersToRemove) {
      // Remove associated wallet
      const walletResult = await Wallet.deleteMany({ userId: user._id });
      if (walletResult.deletedCount > 0) {
        console.log(`  ✅ Deleted wallet for ${user.email}`);
      }

      // Remove the user
      await User.deleteOne({ _id: user._id });
      console.log(`  ✅ Deleted user: ${user.email} (${user.name})`);
    }

    console.log(`\n🎉 Successfully removed ${usersToRemove.length} user(s) and their associated data.`);

  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('\n📡 Disconnected from MongoDB');
  }
}

removeTempleUsers();
