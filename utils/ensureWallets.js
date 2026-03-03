const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const User = require('../models/User');
const Wallet = require('../models/Wallet');
const { sendWalletCreatedEmail } = require('../utils/walletEmailService');

const ensureAllUsersHaveWallets = async () => {
  try {
    console.log('\n🔍 Checking if all users have wallets...\n');
    
    const users = await User.find({ isActive: true });
    console.log(`   Total active users: ${users.length}`);
    
    let walletsCreated = 0;
    let walletsAlreadyExist = 0;
    const usersWithoutWallets = [];
    const usersWithWallets = [];
    
    for (const user of users) {
      const existingWallet = await Wallet.findOne({ userId: user._id });
      
      if (!existingWallet) {
        await Wallet.create({
          userId: user._id,
          balance: 0,
          currency: 'NGN',
          totalEarnings: 0,
          totalSpent: 0,
          isActive: true
        });
        
        // Send wallet created email
        try {
          await sendWalletCreatedEmail(user);
          console.log(`   ✅ Wallet created + email sent: ${user.name} (${user.email})`);
        } catch (emailError) {
          console.log(`   ✅ Wallet created (email failed): ${user.name} (${user.email})`);
        }
        
        walletsCreated++;
        usersWithoutWallets.push(user);
      } else {
        walletsAlreadyExist++;
        usersWithWallets.push(user);
      }
    }
    
    console.log('\n📊 Wallet Check Summary:');
    console.log(`   - Users checked: ${users.length}`);
    console.log(`   - Wallets created: ${walletsCreated}`);
    console.log(`   - Wallets already existed: ${walletsAlreadyExist}`);
    
    if (walletsCreated > 0) {
      console.log('\n📧 New wallet emails sent to:');
      usersWithoutWallets.forEach(user => {
        console.log(`   - ${user.name} (${user.email})`);
      });
    }
    
    return {
      totalUsers: users.length,
      walletsCreated,
      walletsAlreadyExist,
      usersWithoutWallets,
      usersWithWallets
    };
  } catch (error) {
    console.error('❌ Error ensuring all users have wallets:', error.message);
    throw error;
  }
};

module.exports = { ensureAllUsersHaveWallets };
