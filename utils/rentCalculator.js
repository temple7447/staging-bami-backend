/**
 * Utility to calculate dynamic rent increases.
 */

const INCREASE_RATE = 1.26; // 26% increase

// Kept for backwards compatibility with any callers that import it
const RULE_START_DATE = new Date('2000-01-01');

/**
 * Calculates what the rent should be RIGHT NOW based on anniversaries.
 *
 * @param {number} baseAmount - The base price at entry
 * @param {Date} originDate - The start date of occupancy or vacancy
 * @param {boolean} isVacant - Whether to use 1-yr (vacant) or 2-yr (occupied) cycle
 * @returns {number} The current increased rent
 */
const getCurrentRent = (baseAmount, originDate, isVacant) => {
    const start = originDate ? new Date(originDate) : new Date();
    const now = new Date();

    if (now < start) return baseAmount;

    const yearsDiff = (now.getFullYear() - start.getFullYear()) +
        (now.getMonth() - start.getMonth()) / 12 +
        (now.getDate() - start.getDate()) / 365;

    const cycleYears = isVacant ? 1 : 2;
    const cyclesPassed = Math.floor(Math.max(0, yearsDiff) / cycleYears);

    return Math.round(baseAmount * Math.pow(INCREASE_RATE, cyclesPassed));
};

/**
 * Calculates total rent for a specific period, potentially crossing increase boundaries.
 *
 * @param {number} baseAmount - Rent at the BEGINNING of the period
 * @param {Date} startDate - Start of the payment period
 * @param {number} months - Duration in months
 * @param {boolean} isVacant - Cycle type
 * @param {Date} originDate - The absolute reference date (entry date)
 * @returns {Object} { totalAmount, finalRent }
 */
const calculateEffectiveRent = (baseAmount, startDate, months, isVacant, originDate) => {
    const cycleYears = isVacant ? 1 : 2;
    const cycleMonths = cycleYears * 12;
    const start  = new Date(startDate);
    const origin = originDate ? new Date(originDate) : start;

    // Use UTC to match the anchor projection in dashboardController (which uses getUTC* methods).
    // Local-time getMonth() diverges from UTC when dates are stored near midnight UTC (e.g. Lagos UTC+1),
    // causing a 1-month off-by-one that puts the first renewal month in the wrong cycle.
    const startY  = start.getUTCFullYear(),  startM  = start.getUTCMonth(),  startD  = start.getUTCDate();
    const originY = origin.getUTCFullYear(), originM = origin.getUTCMonth(), originD = origin.getUTCDate();

    // Fold the day-of-month gap into a fractional month so a period that begins a few days BEFORE an
    // anniversary still rounds to the correct cycle. Without this, a nextDueDate of June 30 against a
    // July 1 entry counts the first renewal month as 23 months (base) instead of 24 (increased),
    // shaving one month off the 26% increase for the whole renewal year.
    const dayOffset = (startD - originD) / 30;

    let currentRent = baseAmount;
    let totalTotal  = 0;

    for (let i = 0; i < months; i++) {
        const absMonth = startM + i;
        const curY = startY + Math.floor(absMonth / 12);
        const curM = absMonth % 12;

        const monthsSinceOrigin = (curY - originY) * 12 + (curM - originM) + dayOffset;
        const cycles = Math.floor(Math.max(0, Math.round(monthsSinceOrigin)) / cycleMonths);

        const monthlyRent = Math.round(baseAmount * Math.pow(INCREASE_RATE, cycles));
        totalTotal  += monthlyRent;
        currentRent  = monthlyRent;
    }

    return { totalAmount: totalTotal, finalRent: currentRent };
};

/**
 * Checks if a one-time fee (like caution or legal) should be charged.
 * Rule: Only applicable during the first year of stay.
 * 
 * @param {Date} entryDate - The date the tenant moved in
 * @returns {boolean} True if stay duration is less than 1 year
 */
const isOneTimeFeeApplicable = (entryDate) => {
    // UPDATED: Business rule relaxed. Fees are now applicable if configured on the unit/tenant,
    // regardless of stay duration. 
    return true;
};

module.exports = {
    getCurrentRent,
    calculateEffectiveRent,
    isOneTimeFeeApplicable,
    RULE_START_DATE
};
