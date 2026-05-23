/**
 * Adds stock property images to estate: Bami Home and Apartment (6a0d9a5bf2ca79c15de8a2cf)
 * Images sourced from Unsplash (free to use)
 * Run: node scripts/addEstateImages.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Estate = require('../models/Estate');

const ESTATE_ID = '6a0d96101e3664d51908655e';

const IMAGES = [
  {
    url: 'https://images.unsplash.com/photo-1580587771525-78b9dba3b914?w=1200&q=80',
    publicId: null,
    caption: 'Estate exterior — front view'
  },
  {
    url: 'https://images.unsplash.com/photo-1564013799919-ab600027ffc6?w=1200&q=80',
    publicId: null,
    caption: 'Modern apartment building'
  },
  {
    url: 'https://images.unsplash.com/photo-1560448204-e02f11c3d0e2?w=1200&q=80',
    publicId: null,
    caption: 'Living area'
  },
  {
    url: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80',
    publicId: null,
    caption: 'Bright interior'
  },
  {
    url: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80',
    publicId: null,
    caption: 'Furnished apartment'
  },
  {
    url: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1200&q=80',
    publicId: null,
    caption: 'Kitchen area'
  },
  {
    url: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1200&q=80',
    publicId: null,
    caption: 'Comfortable lounge'
  },
  {
    url: 'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=1200&q=80',
    publicId: null,
    caption: 'Bedroom'
  }
];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { family: 4 });
  console.log('Connected to MongoDB');

  const estate = await Estate.findById(ESTATE_ID);
  if (!estate) {
    console.error(`Estate ${ESTATE_ID} not found`);
    process.exit(1);
  }

  console.log(`Found estate: "${estate.name}"`);
  console.log(`Current images: ${estate.images?.length || 0}`);

  estate.images = IMAGES;
  await estate.save();

  console.log(`✅ Added ${IMAGES.length} images to "${estate.name}"`);
  IMAGES.forEach((img, i) => console.log(`  ${i + 1}. ${img.caption}`));

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
