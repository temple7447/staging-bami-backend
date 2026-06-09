const Unit = require('../models/Unit');
const Tenant = require('../models/Tenant');
const { getCurrentRent } = require('./rentCalculator');
const { logInfo, logError } = require('./logger');

/**
 * Service to handle periodic rent increases for vacant and occupied units.
 * This should be called daily by the scheduler.
 *
 * IMPORTANT: Always use the immutable base price (baseRent / unit original price),
 * never compound from an already-increased value. Storing the increased value as
 * the new base causes exponential compounding on every scheduler run.
 */
const processPeriodicRentIncreases = async () => {
    try {
        logInfo('🚀 Starting Periodic Rent/Service Increase Processor');

        // 1. Process Vacant Units (26% every 1 year)
        const vacantUnits = await Unit.find({ status: 'vacant', isActive: true });
        let unitsUpdated = 0;

        for (const unit of vacantUnits) {
            let updated = false;
            const effectiveOriginRent = unit.createdAt || new Date('2024-01-01');
            const effectiveOriginService = unit.createdAt || new Date('2024-01-01');

            // Use originalMonthlyPrice (immutable base) if available, else monthlyPrice.
            // For vacant units we do update monthlyPrice (they have no tenant base to corrupt).
            const baseRentAmt = unit.originalMonthlyPrice || unit.monthlyPrice;
            const baseServiceAmt = unit.originalServiceCharge || unit.serviceChargeMonthly;

            const currentPrice = getCurrentRent(baseRentAmt, effectiveOriginRent, true);
            if (currentPrice > unit.monthlyPrice) {
                unit.monthlyPrice = currentPrice;
                updated = true;
            }

            const currentService = getCurrentRent(baseServiceAmt, effectiveOriginService, true);
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
            const effectiveOriginRent = tenant.entryDate || tenant.createdAt || new Date('2024-01-01');
            const effectiveOriginService = tenant.entryDate || tenant.createdAt || new Date('2024-01-01');

            // Always derive the current rate from the immutable original base so that
            // cycles never compound on top of a previously-increased stored value.
            const creationMeta = tenant.history?.find(h => h.event === 'created')?.meta;
            const baseRentAmt = (tenant.baseRent > 0 ? tenant.baseRent : null)
                || (creationMeta?.rentAmount > 0 ? creationMeta.rentAmount : null)
                || tenant.rentAmount;
            const baseServiceAmt = (tenant.baseServiceCharge > 0 ? tenant.baseServiceCharge : null)
                || (creationMeta?.serviceCharge > 0 ? creationMeta.serviceCharge : null)
                || tenant.serviceChargeAmount;

            const currentPrice = getCurrentRent(baseRentAmt, effectiveOriginRent, false);
            const currentService = getCurrentRent(baseServiceAmt, effectiveOriginService, false);

            let updated = false;

            if (currentPrice !== tenant.rentAmount) {
                const oldPrice = tenant.rentAmount;
                tenant.rentAmount = currentPrice;
                if (currentPrice > oldPrice) {
                    tenant.history.push({
                        event: 'rent_update',
                        note: `Automated biennial 26% rent increase applied (Rule 2024). Increased from NGN ${oldPrice} to NGN ${currentPrice}.`,
                        meta: { oldPrice, newPrice: currentPrice, type: 'rent' },
                        createdBy: null
                    });
                }
                updated = true;
            }

            if (currentService !== tenant.serviceChargeAmount) {
                const oldService = tenant.serviceChargeAmount;
                tenant.serviceChargeAmount = currentService;
                if (currentService > oldService) {
                    tenant.history.push({
                        event: 'rent_update',
                        note: `Automated biennial 26% service charge increase applied (Rule 2024). Increased from NGN ${oldService} to NGN ${currentService}.`,
                        meta: { oldPrice: oldService, newPrice: currentService, type: 'service_charge' },
                        createdBy: null
                    });
                }
                updated = true;
            }

            if (updated) {
                await tenant.save({ validateBeforeSave: false });
                tenantsUpdated++;
                // NOTE: Do NOT update unit.monthlyPrice here. That field stores the original
                // listing price and must remain unchanged so new tenants get the correct base.
            }
        }

        logInfo(`✅ Rent/Service Increase Processor Completed: ${unitsUpdated} units and ${tenantsUpdated} tenants updated.`);

        return { success: true, unitsUpdated, tenantsUpdated };
    } catch (err) {
        logError('Rent Increase Processor error', err);
        return { success: false, error: err.message };
    }
};

module.exports = {
    processPeriodicRentIncreases
};
