'use strict';

/**
 * One-time migration: set baseRent / baseServiceCharge for all tenants and
 * reset their rentAmount back to the original price from creation history.
 *
 * The old getTenant auto-sync bug repeatedly overwrote tenant.rentAmount with
 * the 26%-increased value, causing exponential compounding. This script:
 *   1. Reads the original price from history[event='created'].meta.rentAmount
 *   2. Sets tenant.baseRent = that original price (immutable going forward)
 *   3. Resets tenant.rentAmount = original price so calculations start clean
 *   4. Resets unit.monthlyPrice = original price
 *
 * Run: node scripts/fixBaseRent.js
 */

require('dotenv').config();
const mongoose = require('mongoose');
const Tenant = require('../models/Tenant');
const Unit = require('../models/Unit');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  console.log('Connected to MongoDB');

  const tenants = await Tenant.find({ isActive: true }).populate('unit', 'monthlyPrice serviceChargeMonthly');
  let fixed = 0;
  let skipped = 0;

  for (const tenant of tenants) {
    const creationEntry = tenant.history?.find(h => h.event === 'created');
    const originalRent = creationEntry?.meta?.rentAmount;
    const originalService = creationEntry?.meta?.serviceCharge;

    if (!originalRent) {
      console.warn(`  SKIP ${tenant.tenantName} (${tenant._id}) — no creation history meta`);
      skipped++;
      continue;
    }

    const changes = {};
    if (!tenant.baseRent || tenant.baseRent !== originalRent) {
      changes.baseRent = originalRent;
    }
    if (originalService != null && (!tenant.baseServiceCharge || tenant.baseServiceCharge !== originalService)) {
      changes.baseServiceCharge = originalService;
    }
    // Reset rentAmount to original base so the increase calculator starts fresh
    if (tenant.rentAmount !== originalRent) {
      changes.rentAmount = originalRent;
    }
    if (originalService != null && tenant.serviceChargeAmount !== originalService) {
      changes.serviceChargeAmount = originalService;
    }

    if (Object.keys(changes).length === 0) {
      skipped++;
      continue;
    }

    await Tenant.findByIdAndUpdate(tenant._id, { $set: changes });

    // Also reset the unit's monthlyPrice back to the original base
    if (tenant.unit && changes.rentAmount) {
      await Unit.findByIdAndUpdate(tenant.unit._id || tenant.unit, {
        $set: {
          monthlyPrice: originalRent,
          ...(originalService != null && { serviceChargeMonthly: originalService })
        }
      });
    }

    console.log(`  FIXED ${tenant.tenantName}: rentAmount ${tenant.rentAmount} → ${originalRent}, service ${tenant.serviceChargeAmount} → ${originalService ?? 'unchanged'}`);
    fixed++;
  }

  console.log(`\nDone. Fixed: ${fixed}, Skipped: ${skipped}`);
  await mongoose.disconnect();
}

run().catch(err => {
  console.error(err);
  process.exit(1);
});
