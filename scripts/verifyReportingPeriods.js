const now = new Date();
const year = 2024;

function calculateRange(period, targetYear) {
    let filterStartDate, filterEndDate;
    switch (period) {
        case 'Q1':
            filterStartDate = new Date(targetYear, 0, 1);
            filterEndDate = new Date(targetYear, 2, 31, 23, 59, 59, 999);
            break;
        case 'Q2':
            filterStartDate = new Date(targetYear, 3, 1);
            filterEndDate = new Date(targetYear, 5, 30, 23, 59, 59, 999);
            break;
        case 'Q3':
            filterStartDate = new Date(targetYear, 6, 1);
            filterEndDate = new Date(targetYear, 8, 30, 23, 59, 59, 999);
            break;
        case 'Q4':
            filterStartDate = new Date(targetYear, 9, 1);
            filterEndDate = new Date(targetYear, 11, 31, 23, 59, 59, 999);
            break;
        case '6_months':
            filterStartDate = now;
            filterEndDate = new Date(now.getTime() + 180 * 24 * 60 * 60 * 1000);
            break;
    }
    return { filterStartDate, filterEndDate };
}

console.log('Q1 2024:', calculateRange('Q1', 2024));
console.log('Q2 2024:', calculateRange('Q2', 2024));
console.log('Q3 2024:', calculateRange('Q3', 2024));
console.log('Q4 2024:', calculateRange('Q4', 2024));
console.log('6 Months (Projected):', calculateRange('6_months', 2024));
