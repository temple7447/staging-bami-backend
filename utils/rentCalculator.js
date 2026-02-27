/**
 * Utility to calculate dynamic rent increases based on 2024 business rules.
 */

// Global constant for start of the rule
const RULE_START_DATE = new Date('2024-01-01');
const INCREASE_RATE = 1.26; // 26% increase

/**
 * Calculates what the rent should be RIGHT NOW based on anniversaries.
 * 
 * @param {number} baseAmount - The base price (as of 2024 or entry)
 * @param {Date} originDate - The start date of occupancy or vacancy
 * @param {boolean} isVacant - Whether to use 1-yr (vacant) or 2-yr (occupied) cycle
 * @returns {number} The current increased rent
 */
const getCurrentRent = (baseAmount, originDate, isVacant) => {
    const start = originDate > RULE_START_DATE ? new Date(originDate) : RULE_START_DATE;
    const now = new Date();

    if (now < start) return baseAmount;

    const yearsDiff = (now.getFullYear() - start.getFullYear()) +
        (now.getMonth() - start.getMonth()) / 12 +
        (now.getDate() - start.getDate()) / 365;

    const cycleYears = isVacant ? 1 : 2;
    const cyclesPassed = Math.floor(Math.max(0, yearsDiff) / cycleYears);

    // Compounded interest: Base * (1.26 ^ cyclesPassed)
    return Math.round(baseAmount * Math.pow(INCREASE_RATE, cyclesPassed));
};

/**
 * Calculates total rent for a specific period, potentially crossing increase boundaries.
 * 
 * @param {number} baseAmount - Rent at the BEGINNING of the period
 * @param {Date} startDate - Start of the payment period
 * @param {number} months - Duration in months
 * @param {boolean} isVacant - Cycle type
 * @param {Date} originDate - The absolute reference date (entry or 2024)
 * @returns {Object} { totalAmount, finalRent }
 */
const calculateEffectiveRent = (baseAmount, startDate, months, isVacant, originDate) => {
    const cycleYears = isVacant ? 1 : 2;
    const cycleMonths = cycleYears * 12;
    const absoluteOrigin = originDate > RULE_START_DATE ? new Date(originDate) : RULE_START_DATE;

    let currentRent = baseAmount;
    let totalTotal = 0;

    // We iterate month by month to handle boundaries accurately
    for (let i = 0; i < months; i++) {
        const monthDate = new Date(startDate);
        monthDate.setMonth(monthDate.getMonth() + i);

        // Calculate months since origin
        const totalMonthsSinceOrigin = (monthDate.getFullYear() - absoluteOrigin.getFullYear()) * 12 +
            (monthDate.getMonth() - absoluteOrigin.getMonth());

        const cycles = Math.floor(Math.max(0, totalMonthsSinceOrigin) / cycleMonths);

        // Final monthly rent for this specific month
        const monthlyRentForThisMonth = Math.round(baseAmount * Math.pow(INCREASE_RATE, cycles));

        totalTotal += monthlyRentForThisMonth;
        currentRent = monthlyRentForThisMonth; // Track final state
    }

    return {
        totalAmount: totalTotal,
        finalRent: currentRent
    };
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
