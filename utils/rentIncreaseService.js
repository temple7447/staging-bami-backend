const Unit = require('../models/Unit');
const Tenant = require('../models/Tenant');
const { getCurrentRent } = require('./rentCalculator');
const { logInfo, logError } = require('./logger');

/**
 * Service to handle periodic rent increases for vacant and occupied units.
 * This should be called daily by the scheduler.
 */
const processPeriodicRentIncreases = async () => {
    try {
        logInfo('🚀 Starting Periodic Rent Increase Processor');

        // 1. Process Vacant Units (26% every 1 year)
        const vacantUnits = await Unit.find({ status: 'vacant', isActive: true });
        let unitsUpdated = 0;

        for (const unit of vacantUnits) {
            const origin = unit.lastRentIncreaseDate || unit.createdAt || new Date('2024-01-01');
            const currentPrice = getCurrentRent(unit.basePrice2024 || unit.monthlyPrice, origin, true);

            if (currentPrice > unit.monthlyPrice) {
                const oldPrice = unit.monthlyPrice;
                unit.monthlyPrice = currentPrice;
                unit.lastRentIncreaseDate = new Date(); // Reset cycle to today
                await unit.save();
                unitsUpdated++;
                logInfo(`📈 Vacant Unit ${unit.label} rent increased from ${oldPrice} to ${currentPrice}`);
            }
        }

        // 2. Process Occupied Tenants (26% every 2 years)
        // This handles cases where rent might increase between payments
        const activeTenants = await Tenant.find({ isActive: true, status: 'occupied' });
        let tenantsUpdated = 0;

        for (const tenant of activeTenants) {
            const origin = tenant.lastRentIncreaseDate || tenant.entryDate || tenant.createdAt || new Date('2024-01-01');
            const currentPrice = getCurrentRent(tenant.baseRent2024 || tenant.rentAmount, origin, false);

            if (currentPrice > tenant.rentAmount) {
                const oldPrice = tenant.rentAmount;
                tenant.rentAmount = currentPrice;
                tenant.lastRentIncreaseDate = new Date();

                if (!tenant.history) tenant.history = [];
                tenant.history.push({
                    event: 'rent_update',
                    note: `Automated biennial 26% rent increase applied (Rule 2024). Increased from NGN ${oldPrice} to NGN ${currentPrice}.`,
                    meta: { oldPrice, newPrice: currentPrice },
                    createdBy: null // System
                });

                await tenant.save({ validateBeforeSave: false });
                tenantsUpdated++;
                logInfo(`📈 Tenant ${tenant.tenantName} rent increased from ${oldPrice} to ${currentPrice}`);

                // Also update the unit's price to keep in sync if unit is associated
                if (tenant.unit) {
                    await Unit.findByIdAndUpdate(tenant.unit, { monthlyPrice: currentPrice });
                }
            }
        }

        logInfo(`✅ Rent Increase Processor Completed: ${unitsUpdated} units and ${tenantsUpdated} tenants updated.`);

        return {
            success: true,
            unitsUpdated,
            tenantsUpdated
        };
    } catch (err) {
        logError('Rent Increase Processor error', err);
        return { success: false, error: err.message };
    }
};

module.exports = {
    processPeriodicRentIncreases
};
