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
        const units = await Unit.find({ $or: [{ basePrice2024: { $exists: false } }, { baseServiceCharge2024: { $exists: false } }] });
        for (const unit of units) {
            if (unit.basePrice2024 === undefined) unit.basePrice2024 = unit.monthlyPrice;
            if (unit.baseServiceCharge2024 === undefined) unit.baseServiceCharge2024 = unit.serviceChargeMonthly || 0;

            const origin = unit.createdAt < RULE_START_DATE ? RULE_START_DATE : unit.createdAt;
            if (!unit.lastRentIncreaseDate) unit.lastRentIncreaseDate = origin;
            if (!unit.lastServiceIncreaseDate) unit.lastServiceIncreaseDate = origin;

            await unit.save();
        }
        console.log(`Initialized/Updated ${units.length} units.`);

        // 2. Initialize Tenants
        console.log('Initializing Tenants...');
        const tenants = await Tenant.find({ $or: [{ baseRent2024: { $exists: false } }, { baseServiceCharge2024: { $exists: false } }] });
        for (const tenant of tenants) {
            if (tenant.baseRent2024 === undefined) tenant.baseRent2024 = tenant.rentAmount;
            if (tenant.baseServiceCharge2024 === undefined) tenant.baseServiceCharge2024 = tenant.serviceChargeAmount || (tenant.unit?.serviceChargeMonthly) || 0;
            if (tenant.serviceChargeAmount === 0 || tenant.serviceChargeAmount === undefined) {
                tenant.serviceChargeAmount = tenant.baseServiceCharge2024;
            }

            const origin = (tenant.entryDate || tenant.createdAt) < RULE_START_DATE ? RULE_START_DATE : (tenant.entryDate || tenant.createdAt);
            if (!tenant.lastRentIncreaseDate) tenant.lastRentIncreaseDate = origin;
            if (!tenant.lastServiceIncreaseDate) tenant.lastServiceIncreaseDate = origin;

            await tenant.save({ validateBeforeSave: false });
        }
        console.log(`Initialized/Updated ${tenants.length} tenants.`);

        console.log('Migration completed successfully.');
        process.exit(0);
    } catch (err) {
        console.error('Migration failed:', err);
        process.exit(1);
    }
}

migrate();
