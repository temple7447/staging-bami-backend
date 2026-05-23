require('dotenv').config();
const mongoose = require('mongoose');

// Load all models to avoid "Schema hasn't been registered" errors
require('../models/Estate');
require('../models/Unit');
const Enquiry = require('../models/Enquiry');
const RentalApplication = require('../models/RentalApplication');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { family: 4 });

  const enquiries = await Enquiry.find({})
    .populate('estate', 'name')
    .populate('unit', 'label')
    .lean();

  console.log(`\n=== ENQUIRIES (${enquiries.length}) ===`);
  enquiries.forEach(e => console.log({
    id: e._id.toString(),
    name: e.name,
    email: e.email,
    estate: e.estate?.name,
    unit: e.unit?.label || 'N/A',
    message: e.message,
    status: e.status,
    createdAt: e.createdAt
  }));

  const apps = await RentalApplication.find({})
    .populate('estate', 'name')
    .populate('unit', 'label')
    .lean();

  console.log(`\n=== RENTAL APPLICATIONS (${apps.length}) ===`);
  apps.forEach(a => console.log({
    id: a._id.toString(),
    fullName: a.fullName,
    email: a.email,
    estate: a.estate?.name,
    unit: a.unit?.label || 'N/A',
    employmentStatus: a.employmentStatus,
    status: a.status,
    createdAt: a.createdAt
  }));

  await mongoose.disconnect();
}

run().catch(err => { console.error(err.message); process.exit(1); });
