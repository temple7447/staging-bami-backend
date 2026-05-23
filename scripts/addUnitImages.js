/**
 * Adds stock property images to unit: Flat 1 (6a0d9a5bf2ca79c15de8a2cf)
 * Run: node scripts/addUnitImages.js
 */
require('dotenv').config();
const mongoose = require('mongoose');
const Unit = require('../models/Unit');

const UNIT_ID = '6a0d9a5bf2ca79c15de8a2cf';

const IMAGES = [
  {
    url: 'https://images.unsplash.com/photo-1522708323590-d24dbb6b0267?w=1200&q=80',
    publicId: null,
    caption: 'Living room'
  },
  {
    url: 'https://images.unsplash.com/photo-1502672260266-1c1ef2d93688?w=1200&q=80',
    publicId: null,
    caption: 'Bright open interior'
  },
  {
    url: 'https://images.unsplash.com/photo-1484154218962-a197022b5858?w=1200&q=80',
    publicId: null,
    caption: 'Kitchen'
  },
  {
    url: 'https://images.unsplash.com/photo-1571003123894-1f0594d2b5d9?w=1200&q=80',
    publicId: null,
    caption: 'Bedroom'
  },
  {
    url: 'https://images.unsplash.com/photo-1552321554-5fefe8c9ef14?w=1200&q=80',
    publicId: null,
    caption: 'Bathroom'
  },
  {
    url: 'https://images.unsplash.com/photo-1555041469-a586c61ea9bc?w=1200&q=80',
    publicId: null,
    caption: 'Lounge area'
  }
];

async function run() {
  await mongoose.connect(process.env.MONGODB_URI, { family: 4 });
  console.log('Connected to MongoDB');

  const unit = await Unit.findById(UNIT_ID);
  if (!unit) {
    console.error(`Unit ${UNIT_ID} not found`);
    process.exit(1);
  }

  console.log(`Found unit: "${unit.label}" in estate ${unit.estate}`);
  console.log(`Current images: ${unit.images?.length || 0}`);

  unit.images = IMAGES;
  await unit.save();

  console.log(`✅ Added ${IMAGES.length} images to "${unit.label}"`);
  IMAGES.forEach((img, i) => console.log(`  ${i + 1}. ${img.caption}`));

  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
