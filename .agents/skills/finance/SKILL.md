---
name: finance
description: >
  Expert finance skill for Nigerian property managers. Use for payment reminders,
  cash flow analysis, revenue tracking, expense management, budgeting, and
  financial reporting. Trigger on: finance, payment, rent, revenue, cash flow,
  budget, expense, invoice, reminder, collection, outstanding, arrears, P&L.
---

# Finance Skill

Expert Nigerian property finance manager specializing in payment collection, cash flow optimization, and financial reporting.

## Core Capabilities

### 1. Payment Reminder Strategy

| Days Overdue | Tone | Approach |
|--------------|------|----------|
| 1-3 days | Friendly | Gentle reminder, assume oversight |
| 4-7 days | Warm but firm | Direct request, offer help |
| 8-14 days | Professional | Clear statement, deadline |
| 15-30 days | Firm | Urgency, consequences |
| 31+ days | Final notice | Legal implication, last chance |

### 2. Reminder Templates

#### Friendly (1-3 days)
```
Hi [Name],

Hope you're doing well! This is a quick reminder that your rent payment of ₦[Amount] was due on [Date].

No worries if it slipped your mind — here's the payment link: [Link]

Let me know if you need anything!
```

#### Firm (8-14 days)
```
Hi [Name],

I'm following up on your outstanding rent balance of ₦[Amount], now [X] days overdue.

To avoid any inconvenience, please make payment by [Date]. 

Payment options:
- Bank transfer: [Details]
- Online: [Link]

Questions? I'm here to help.
```

#### Final Notice (31+ days)
```
Hi [Name],

This is a final reminder regarding your unpaid rent of ₦[Amount], which is now [X] days overdue.

Please settle this balance by [Date] to avoid [consequences per lease terms].

If you're experiencing difficulties, let's discuss a payment plan. I'm available to talk.
```

### 3. Cash Flow Analysis Framework

#### Revenue Components
- **Rent Collections**: Expected vs. Actual
- **Service Charge**: Collection rate
- **Late Fees**: Penalty income
- **Other Income**: Parking, storage, etc.

#### Expense Categories
- **Fixed**: Security, cleaning, insurance
- **Variable**: Maintenance, repairs
- **One-time**: Equipment, upgrades

#### Key Metrics
- **Collection Rate**: Collected / Expected × 100
- **Occupancy Rate**: Occupied / Total Units × 100
- **Revenue per Unit**: Total Revenue / Total Units
- **Days Sales Outstanding**: Average days to collect

### 4. Revenue Optimization Strategies

| Strategy | Implementation |
|----------|---------------|
| Early payment discount | 2-5% discount for payment before due date |
| Late fee enforcement | Clear policy, consistently applied |
| Multiple payment channels | Bank, card, USSD, mobile |
| Auto-debit setup | Direct debit from bank account |
| Annual payment incentive | Discount for full-year upfront |

### 5. Financial Reporting

#### Monthly Report Structure
```
# Monthly Financial Summary — [Estate]

## Revenue
- Rent Collected: ₦X (Y% of expected)
- Outstanding: ₦X (Z tenants)
- Service Charge: ₦X

## Expenses
- Maintenance: ₦X
- Security: ₦X
- Other: ₦X

## Key Metrics
- Occupancy: X%
- Collection Rate: X%
- Days to Collect: X

## Action Items
- [Specific tenant follow-ups]
- [Expense optimizations]
```

## Nigerian Property Finance Context

### Payment Norms
- Annual rent is standard (12 months upfront)
- Quarterly payments becoming more common
- Bank transfers dominate (not cards)
- Cash payments declining (traceability issues)
- Mobile money growing (OPay, PalmPay)

### Tax Considerations
- Rent income is taxable (personal income tax)
- VAT applies to commercial properties
- Withholding tax on rental income
- Stamp duty on tenancy agreements

### Common Challenges
- Tenants paying late (cultural norm in some areas)
- Currency fluctuations affecting expenses
- Inflation impacting maintenance costs
- Informal payments (hard to track)

## Key Metrics Dashboard

| Metric | Target | Warning |
|--------|--------|---------|
| Collection Rate | >95% | <85% |
| Occupancy Rate | >90% | <80% |
| Days to Collect | <7 days | >14 days |
| Outstanding Ratio | <5% | >15% |
| Expense Ratio | <30% | >40% |
