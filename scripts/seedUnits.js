require('dotenv').config();
const mongoose = require('mongoose');
const Unit = require('../models/Unit');

const ESTATE_ID = '6a09c61b698d3ed23ac8b84b';
const ADMIN_ID  = '69e92fc458e5e9168139e83f';

const units = [
  {
    label: 'Apt A1 – 1 Bedroom Studio',
    monthlyPrice: 85000,
    serviceChargeMonthly: 8000,
    cautionFee: 85000,
    legalFee: 42500,
    meterNumber: 'MTR-001-A1',
    description: 'Cozy 1-bedroom studio on the ground floor. Tiled throughout, fitted kitchen, 24/7 security.',
    category: 'Studio',
    listingType: 'Rent',
    bedrooms: 1,
    bathrooms: 1,
    area: 45,
    amenities: { wifi: false, pool: false, gym: false, parking: true, ac: true, security: true, petFriendly: false, balcony: false, laundry: false },
    status: 'vacant',
  },
  {
    label: 'Apt B2 – 2 Bedroom Flat',
    monthlyPrice: 150000,
    serviceChargeMonthly: 12000,
    cautionFee: 150000,
    legalFee: 75000,
    meterNumber: 'MTR-002-B2',
    description: 'Spacious 2-bedroom apartment on the 2nd floor with a balcony and fitted wardrobes.',
    category: 'Apartment',
    listingType: 'Rent',
    bedrooms: 2,
    bathrooms: 2,
    area: 80,
    amenities: { wifi: true, pool: false, gym: false, parking: true, ac: true, security: true, petFriendly: false, balcony: true, laundry: false },
    status: 'vacant',
  },
  {
    label: 'Apt C3 – 3 Bedroom Apartment',
    monthlyPrice: 220000,
    serviceChargeMonthly: 18000,
    cautionFee: 220000,
    legalFee: 110000,
    meterNumber: 'MTR-003-C3',
    description: 'Large 3-bedroom apartment with open-plan living area, balcony, and dedicated parking.',
    category: 'Apartment',
    listingType: 'Rent',
    bedrooms: 3,
    bathrooms: 2,
    area: 120,
    amenities: { wifi: true, pool: false, gym: false, parking: true, ac: true, security: true, petFriendly: true, balcony: true, laundry: true },
    status: 'vacant',
  },
  {
    label: 'Apt D4 – Executive Penthouse',
    monthlyPrice: 450000,
    serviceChargeMonthly: 35000,
    cautionFee: 450000,
    legalFee: 225000,
    meterNumber: 'MTR-004-D4',
    description: 'Top-floor penthouse with panoramic views, private terrace, pool access, and gym.',
    category: 'Penthouse',
    listingType: 'Rent',
    bedrooms: 4,
    bathrooms: 3,
    area: 220,
    amenities: { wifi: true, pool: true, gym: true, parking: true, ac: true, security: true, petFriendly: false, balcony: true, laundry: true },
    status: 'vacant',
  },
  {
    label: 'Office E5 – Commercial Space',
    monthlyPrice: 180000,
    serviceChargeMonthly: 20000,
    cautionFee: 180000,
    legalFee: 90000,
    meterNumber: 'MTR-005-E5',
    description: 'Open-plan commercial office space on the ground floor. Suitable for small businesses, ideal for 10–15 staff.',
    category: 'Office',
    listingType: 'Rent',
    bedrooms: 0,
    bathrooms: 2,
    area: 95,
    amenities: { wifi: true, pool: false, gym: false, parking: true, ac: true, security: true, petFriendly: false, balcony: false, laundry: false },
    status: 'vacant',
  },
];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB\n');

  let created = 0;
  for (const u of units) {
    try {
      const unit = await Unit.create({
        ...u,
        estate: ESTATE_ID,
        createdBy: ADMIN_ID,
        basePrice2024: u.monthlyPrice,
        lastRentIncreaseDate: new Date(),
        baseServiceCharge2024: u.serviceChargeMonthly,
        lastServiceIncreaseDate: new Date(),
        baseCaution2024: u.cautionFee,
        lastCautionIncreaseDate: new Date(),
        baseLegal2024: u.legalFee,
        lastLegalIncreaseDate: new Date(),
      });
      console.log(`✅ Created: ${unit.label} (ID: ${unit._id})`);
      created++;
    } catch (err) {
      console.error(`❌ Failed: ${u.label} — ${err.message}`);
    }
  }

  console.log(`\nDone. ${created}/${units.length} units created.`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err.message);
  process.exit(1);
});
