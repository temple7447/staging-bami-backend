#!/usr/bin/env node

/**
 * SCRIPT TO SET TEST DATA WITH KNOWN CREDENTIALS
 */

const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');

async function setupTestUsers() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('✓ Connected to MongoDB\n');

    // Find or create super admin
    let superAdmin = await User.findOne({ role: 'super_admin' });
    if (!superAdmin) {
      console.log('Creating super admin...');
      superAdmin = await User.create({
        name: 'Super Administrator',
        email: 'admin@bamihustle.com',
        password: 'SuperAdmin123!',
        role: 'super_admin',
        emailVerified: true,
        isActive: true
      });
    } else {
      // Update password to known value
      superAdmin.password = 'Password123!';
      await superAdmin.save();
      console.log('Updated super admin password');
    }

    console.log(`✓ Super Admin: ${superAdmin.email} / Password123!\n`);

    // Find managers
    let managers = await User.find({ role: 'manager' });
    console.log(`✓ Found ${managers.length} manager(s)`);
    managers.forEach((m, idx) => {
      console.log(`  ${idx + 1}. ${m.name} (${m.email})`);
    });

    if (managers.length === 0) {
      console.log('\nCreating test managers...');
      const m1 = await User.create({
        name: 'Test Manager One',
        email: `manager1_${Date.now()}@test.com`,
        password: 'Manager123!',
        role: 'manager',
        phone: '+2348000000001',
        createdBy: superAdmin._id,
        emailVerified: true,
        isActive: true
      });
      console.log(`✓ Manager 1: ${m1.email}`);

      const m2 = await User.create({
        name: 'Test Manager Two',
        email: `manager2_${Date.now()}@test.com`,
        password: 'Manager123!',
        role: 'manager',
        phone: '+2348000000002',
        createdBy: superAdmin._id,
        emailVerified: true,
        isActive: true
      });
      console.log(`✓ Manager 2: ${m2.email}\n`);
    }

    console.log('✅ Test setup complete!');
    await mongoose.connection.close();
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

setupTestUsers();
