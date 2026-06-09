require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');

const connectDatabase = require(path.join(__dirname, '../config/database'));

const Estate = require(path.join(__dirname, '../models/Estate'));
const Unit = require(path.join(__dirname, '../models/Unit'));
const Tenant = require(path.join(__dirname, '../models/Tenant'));
const User = require(path.join(__dirname, '../models/User'));

async function seed() {
  await connectDatabase();

  console.log('Creating seed data...\n');

  // 0. Create or find admin user (for createdBy field)
  let admin = await User.findOne({ email: 'admin@test.com' });
  if (!admin) {
    const bcrypt = require('bcryptjs');
    admin = await User.create({
      name: 'Test Admin',
      email: 'admin@test.com',
      password: 'Admin123!',
      role: 'super_admin',
      emailVerified: true
    });
    console.log('✅ Created admin user:', admin.email);
  } else {
    console.log('✅ Admin user already exists:', admin.email);
  }

  // 1. Create Estate
  let estate = await Estate.findOne({ name: 'Test Estate', isActive: true });
  if (!estate) {
    estate = await Estate.create({
      name: 'Test Estate',
      description: 'A test estate for demo purposes',
      totalUnits: 10,
      createdBy: admin._id
    });
    console.log('✅ Created estate:', estate.name);
  } else {
    console.log('✅ Estate already exists:', estate.name);
  }

  // 2. Create Apartment/Unit
  let unit = await Unit.findOne({ estate: estate._id, label: 'Apartment 1', isActive: true });
  if (!unit) {
    unit = await Unit.create({
      estate: estate._id,
      label: 'Apartment 1',
      monthlyPrice: 500000,
      serviceChargeMonthly: 50000,
      cautionFee: 500000,
      legalFee: 50000,
      meterNumber: 'E001',
      category: 'Apartment',
      status: 'vacant',
      description: 'A nice 2-bedroom apartment',
      createdBy: admin._id
    });
    console.log('✅ Created unit:', unit.label);
  } else {
    console.log('✅ Unit already exists:', unit.label);
  }

  // 3. Create or find tenant user
  let user = await User.findOne({ email: 'tenant@test.com' });
  if (!user) {
    user = await User.create({
      name: 'Test Tenant',
      email: 'tenant@test.com',
      password: 'TempPass123',
      role: 'tenant',
      emailVerified: true
    });
    console.log('✅ Created tenant user: tenant@test.com (password: TempPass123)');
  } else {
    console.log('✅ Tenant user already exists:', user.email);
  }

  // 4. Create Tenant record
  let tenant = await Tenant.findOne({ estate: estate._id, isActive: true, tenantEmail: 'tenant@test.com' });
  if (!tenant) {
    const now = new Date();
    const nextDue = new Date(now);
    nextDue.setFullYear(now.getFullYear() + 1);

    tenant = await Tenant.create({
      estate: estate._id,
      unit: unit._id,
      unitLabel: unit.label,
      tenantName: 'Test Tenant',
      tenantEmail: 'tenant@test.com',
      tenantPhone: '08012345678',
      rentAmount: unit.monthlyPrice,
      serviceChargeAmount: unit.serviceChargeMonthly,
      tenantType: 'new',
      electricMeterNumber: unit.meterNumber,
      entryDate: now,
      nextDueDate: nextDue,
      status: 'occupied',
      user: user._id,
      createdBy: admin._id
    });

    // Update unit to occupied
    unit.status = 'occupied';
    unit.occupiedBy = tenant._id;
    unit.occupiedSince = now;
    await unit.save();

    console.log('✅ Created tenant:', tenant.tenantName);
  } else {
    console.log('✅ Tenant already exists:', tenant.tenantName);
  }

  console.log('\n📋 Summary:');
  console.log('  Estate:', estate.name, `(${estate._id})`);
  console.log('  Unit:', unit.label, `(${unit._id})`);
  console.log('  Tenant:', tenant.tenantName, tenant.tenantEmail, `(${tenant._id})`);

  await mongoose.disconnect();
  console.log('\n✅ Seed completed!');
  process.exit(0);
}

seed().catch(err => {
  console.error('Seed error:', err);
  process.exit(1);
});