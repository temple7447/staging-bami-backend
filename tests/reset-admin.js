#!/usr/bin/env node

const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const dotenv = require('dotenv');
const path = require('path');

dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
const colors = {
  reset: '\x1b[0m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m'
};

async function resetAdminPassword() {
  try {
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(`${colors.green}✓ Connected to MongoDB${colors.reset}\n`);

    // Find or create test admin
    let admin = await User.findOne({ email: 'test_admin@bamihustle.com' });
    
    if (!admin) {
      console.log(`${colors.yellow}Creating new test admin...${colors.reset}`);
      admin = await User.create({
        name: 'Test Administrator',
        email: 'test_admin@bamihustle.com',
        password: 'TestAdmin123!',
        role: 'super_admin',
        emailVerified: true,
        isActive: true
      });
    } else {
      console.log(`${colors.yellow}Updating password for existing admin...${colors.reset}`);
      admin.password = 'TestAdmin123!';
      await admin.save();
    }

    console.log(`\n${colors.green}✅ Admin Ready:${colors.reset}`);
    console.log(`   Email: ${admin.email}`);
    console.log(`   Password: TestAdmin123!`);
    console.log(`   Role: ${admin.role}\n`);

    // Create managers
    const existingManagers = await User.countDocuments({ role: 'manager' });
    
    if (existingManagers < 2) {
      console.log(`${colors.yellow}Creating test managers...${colors.reset}`);
      
      for (let i = 1; i <= 2; i++) {
        const existing = await User.findOne({ email: `manager${i}@bamihustle.com` });
        if (!existing) {
          await User.create({
            name: `Test Manager ${i}`,
            email: `manager${i}@bamihustle.com`,
            password: 'Manager123!',
            role: 'manager',
            phone: `+234800000000${i}`,
            createdBy: admin._id,
            emailVerified: true,
            isActive: true
          });
          console.log(`   ✓ Manager ${i} created`);
        }
      }
      console.log();
    }

    console.log(`${colors.green}✅ Test data ready!${colors.reset}`);
    await mongoose.connection.close();
  } catch (error) {
    console.error(`${colors.red}❌ Error: ${error.message}${colors.reset}`);
    await mongoose.connection.close();
    process.exit(1);
  }
}

resetAdminPassword();
