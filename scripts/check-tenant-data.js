require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');

const connectDatabase = require(path.join(__dirname, '../config/database'));
const User = require(path.join(__dirname, '../models/User'));
const Tenant = require(path.join(__dirname, '../models/Tenant'));
const Unit = require(path.join(__dirname, '../models/Unit'));

async function checkTenantData() {
  await connectDatabase();

  const user = await User.findOne({ email: 'tenant@test.com' });
  const tenant = await Tenant.findOne({ user: user._id, isActive: true }).populate('unit');

  console.log('=== TENANT DATA ===');
  console.log('rentAmount:', tenant.rentAmount);
  console.log('serviceChargeAmount:', tenant.serviceChargeAmount);
  console.log('entryDate:', tenant.entryDate);
  console.log('nextDueDate:', tenant.nextDueDate);

  if (tenant.unit) {
    console.log('\n=== UNIT DATA ===');
    console.log('monthlyPrice:', tenant.unit.monthlyPrice);
    console.log('serviceChargeMonthly:', tenant.unit.serviceChargeMonthly);
    console.log('unitLabel:', tenant.unit.unitLabel);
  }

  await mongoose.disconnect();
  process.exit(0);
}

checkTenantData().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
