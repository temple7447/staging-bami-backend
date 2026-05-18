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
        logInfo('🚀 Starting Periodic Rent/Service Increase Processor');

        // 1. Process Vacant Units (26% every 1 year)
        const vacantUnits = await Unit.find({ status: 'vacant', isActive: true });
        let unitsUpdated = 0;

        for (const unit of vacantUnits) {
            let updated = false;
            // Anchor = original/creation date; never overwrite this after applying an increase,
            // otherwise the next cycle never elapses and compound increases stop triggering.
            const effectiveOriginRent = unit.lastRentIncreaseDate || unit.createdAt || new Date('2024-01-01');
            const effectiveOriginService = unit.lastServiceIncreaseDate || unit.createdAt || new Date('2024-01-01');

            // Rent Increase
            const currentPrice = getCurrentRent(unit.basePrice2024 || unit.monthlyPrice, effectiveOriginRent, true);
            if (currentPrice > unit.monthlyPrice) {
                unit.monthlyPrice = currentPrice;
                updated = true;
            }

            // Service Charge Increase
            const currentService = getCurrentRent(unit.baseServiceCharge2024 || unit.serviceChargeMonthly, effectiveOriginService, true);
            if (currentService > unit.serviceChargeMonthly) {
                unit.serviceChargeMonthly = currentService;
                updated = true;
            }

            if (updated) {
                await unit.save();
                unitsUpdated++;
            }
        }

        // 2. Process Occupied Tenants (26% every 2 years)
        const activeTenants = await Tenant.find({ isActive: true, status: 'occupied' });
        let tenantsUpdated = 0;

        for (const tenant of activeTenants) {
            let updated = false;
            // Anchor = entry date; never overwrite this after applying an increase,
            // otherwise the next 2-year cycle never elapses and compound increases stop triggering.
            const effectiveOriginRent = tenant.lastRentIncreaseDate || tenant.entryDate || tenant.createdAt || new Date('2024-01-01');
            const effectiveOriginService = tenant.lastServiceIncreaseDate || tenant.entryDate || tenant.createdAt || new Date('2024-01-01');

            // Rent Increase
            const currentPrice = getCurrentRent(tenant.baseRent2024 || tenant.rentAmount, effectiveOriginRent, false);
            if (currentPrice > tenant.rentAmount) {
                const oldPrice = tenant.rentAmount;
                tenant.rentAmount = currentPrice;

                tenant.history.push({
                    event: 'rent_update',
                    note: `Automated biennial 26% rent increase applied (Rule 2024). Increased from NGN ${oldPrice} to NGN ${currentPrice}.`,
                    meta: { oldPrice, newPrice: currentPrice, type: 'rent' },
                    createdBy: null
                });
                updated = true;
            }

            // Service Charge Increase
            const currentService = getCurrentRent(tenant.baseServiceCharge2024 || tenant.serviceChargeAmount, effectiveOriginService, false);
            if (currentService > tenant.serviceChargeAmount) {
                const oldService = tenant.serviceChargeAmount;
                tenant.serviceChargeAmount = currentService;

                tenant.history.push({
                    event: 'rent_update',
                    note: `Automated biennial 26% service charge increase applied (Rule 2024). Increased from NGN ${oldService} to NGN ${currentService}.`,
                    meta: { oldPrice: oldService, newPrice: currentService, type: 'service_charge' },
                    createdBy: null
                });
                updated = true;
            }

            if (updated) {
                await tenant.save({ validateBeforeSave: false });
                tenantsUpdated++;

                // Keep unit prices in sync
                if (tenant.unit) {
                    await Unit.findByIdAndUpdate(tenant.unit, {
                        monthlyPrice: tenant.rentAmount,
                        serviceChargeMonthly: tenant.serviceChargeAmount
                    });
                }
            }
        }

        logInfo(`✅ Rent/Service Increase Processor Completed: ${unitsUpdated} units and ${tenantsUpdated} tenants updated.`);

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
