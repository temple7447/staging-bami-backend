require('dotenv').config();
const path = require('path');
const mongoose = require('mongoose');

const connectDatabase = require(path.join(__dirname, '../config/database'));
const User = require(path.join(__dirname, '../models/User'));
const Tenant = require(path.join(__dirname, '../models/Tenant'));
const Unit = require(path.join(__dirname, '../models/Unit'));

async function reduceFees() {
  await connectDatabase();

  const user = await User.findOne({ email: 'tenant@test.com' });
  if (!user) {
    console.error('User tenant@test.com not found');
    process.exit(1);
  }

  const tenant = await Tenant.findOne({ user: user._id, isActive: true });
  if (!tenant) {
    console.error('Tenant not found');
    process.exit(1);
  }

  const unit = await Unit.findById(tenant.unit);
  if (!unit) {
    console.error('Unit not found');
    process.exit(1);
  }

  // Set all fees to 5000 Naira (under 10k)
  const newPrice = 5000;

  unit.monthlyPrice = newPrice;
  unit.serviceChargeMonthly = newPrice;
  unit.cautionFee = newPrice;
  unit.legalFee = newPrice;
  await unit.save();
  console.log('Unit fees updated');

  tenant.rentAmount = newPrice;
  tenant.serviceChargeAmount = newPrice;
  await tenant.save();
  console.log('Tenant fees updated');

  console.log('\nAll fees reduced to 5,000 Naira for tenant@test.com');
  console.log('Rent: 5,000/mo');
  console.log('Service Charge: 5,000/mo');
  console.log('Caution Fee: 5,000');
  console.log('Legal Fee: 5,000');

  await mongoose.disconnect();
  process.exit(0);
}

reduceFees().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
