const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Fix paths for running from the root
const Unit = require('../models/Unit');
const Tenant = require('../models/Tenant');
const { RULE_START_DATE } = require('../utils/rentCalculator');

dotenv.config();

/**
 * Migration script to initialize baseline rent values for the 2024 rule.
 */
async function migrate() {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // 1. Initialize Units
        console.log('Initializing Units...');
        const units = await Unit.find({ basePrice2024: { $exists: false } });
        for (const unit of units) {
            unit.basePrice2024 = unit.monthlyPrice;
            // Reference point for vacancy increase
            unit.lastRentIncreaseDate = unit.createdAt < RULE_START_DATE ? RULE_START_DATE : unit.createdAt;
            await unit.save();
        }
        console.log(`Initialized ${units.length} units.`);

        // 2. Initialize Tenants
        console.log('Initializing Tenants...');
        const tenants = await Tenant.find({ baseRent2024: { $exists: false } });
        for (const tenant of tenants) {
            tenant.baseRent2024 = tenant.rentAmount;
            // Reference point for occupancy increase
            tenant.lastRentIncreaseDate = tenant.entryDate < RULE_START_DATE ? RULE_START_DATE : (tenant.entryDate || tenant.createdAt);
            await tenant.save({ validateBeforeSave: false });
        }
        console.log(`Initialized ${tenants.length} tenants.`);

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
