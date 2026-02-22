# BamiHustle Global Fund Distribution System (50/30/20)

## Overview

The system now implements **automatic fund distribution for ALL deposits/payments** across the entire platform. Every payment received is automatically distributed across three accounts:

- **Marketing & Investment**: 50%
- **Owner Withdraw**: 30%  
- **Operations & Maintenance**: 20%

## Implementation Details

### Distribution Trigger Points

Distribution is automatically applied when:

1. **Any payment is successfully verified** by Paystack
2. Payment status transitions from `pending` → `completed`
3. **All payment types trigger distribution**:
   - Rent payments
   - Deposits
   - Service charges
   - Security charges
   - Caution fees
   - Legal fees

### Affected Payment Types

The 50/30/20 split applies to:

| Payment Type | Route | Distribution |
|---|---|---|
| Deposit | `POST /api/payments/deposit` | ✅ Automatic |
| Rent | `POST /api/payments/rent` | ✅ Automatic |
| Service Charge | `POST /api/payments/service_charge` | ✅ Automatic |
| Caution Fee | `POST /api/payments/caution_fee` | ✅ Automatic |
| Legal Fee | `POST /api/payments/legal_fee` | ✅ Automatic |

### Distribution Flow

```
Payment Received (any type)
    ↓
Paystack Verification (/api/payments/verify/:reference)
    ↓
Payment Status = "completed"
    ↓
Distribution Service Triggered
    ↓
Calculate Amounts:
  - Marketing: amount × 0.50
  - Owner: amount × 0.30
  - Operations: amount × 0.20
    ↓
Update WalletAccount
  - Add to respective balances
  - Log transaction in distribution history
  - Record payment reference
    ↓
Response Logged with Breakdown
```

## Example Scenario

If a tenant pays ₦100,000 for rent:

```
Total Payment: ₦100,000

Distribution (Automatic):
├─ Marketing Account: +₦50,000 (50%)
├─ Owner Account: +₦30,000 (30%)
└─ Operations Account: +₦20,000 (20%)
```

## Technical Implementation

### Files Modified

1. **`/utils/distributionService.js`**
   - Added `DISTRIBUTION_PERCENTAGES` constant
   - Added `calculateDistribution()` function
   - Enhanced `distributePayment()` with global application
   - Exported calculation functions for reuse

2. **`/controllers/paymentController.js`**
   - Modified `verifyPayment()` to trigger distribution for ALL payment types
   - Enhanced logging with distribution breakdown
   - Distribution now applies on successful payment verification

### Key Functions

#### `distributePayment(estateId, amount, paymentId, paymentType)`

Distributes payment amount to three accounts for an estate:

```javascript
const result = await distributePayment(
  estateId,
  100000,
  paymentId,
  'rent'  // Payment type
);

// Returns:
{
  success: true,
  distribution: {
    marketing: 50000,
    owner: 30000,
    operations: 20000,
    total: 100000
  },
  walletAccount: {
    marketing: walletBalance.marketing,
    owner: walletBalance.owner,
    operations: walletBalance.operations,
    total: walletBalance.total
  }
}
```

#### `calculateDistribution(amount)`

Calculates distribution amounts without modifying balances:

```javascript
const breakdown = calculateDistribution(100000);
// Returns: { marketing: 50000, owner: 30000, operations: 20000 }
```

#### `getWalletBalance(estateId)`

Retrieves current wallet account balances:

```javascript
const balance = await getWalletBalance(estateId);
// Returns:
{
  estateId,
  marketing: { balance: 500000, percentage: 50 },
  owner: { balance: 300000, percentage: 30 },
  operations: { balance: 200000, percentage: 20 },
  totalReceived: 1000000,
  totalBalance: 1000000,
  lastUpdated: Date
}
```

#### `getDistributionHistory(estateId, limit = 100)`

Retrieves distribution transaction history:

```javascript
const history = await getDistributionHistory(estateId);
// Returns: { marketing: [...], owner: [...], operations: [...] }
// Each contains transaction logs with payment ID, amount, type, date
```

## API Endpoints

### Initiate Payment (Any Type)

```http
POST /api/payments/{type}
Content-Type: application/json
Authorization: Bearer {token}

{
  "tenantId": "tenant_id",
  "amount": 100000,
  "description": "Optional payment description"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Rent payment initiated successfully",
  "data": {
    "paymentId": "payment_id",
    "paymentLink": "https://checkout.paystack.com/...",
    "reference": "paystack_reference",
    "amount": 100000,
    "type": "rent"
  }
}
```

### Verify Payment (Triggers Distribution)

```http
GET /api/payments/verify/{reference}
Authorization: Bearer {token}
```

**Response (on success):**
```json
{
  "success": true,
  "message": "Payment verification successful - Status: success",
  "data": {
    "paymentId": "payment_id",
    "status": "completed",
    "amount": 100000,
    "type": "rent",
    "tenant": { "name": "John Doe", "unit": "Unit A" },
    "estate": { "name": "Sunset Estate" }
  }
}
```

**Distribution is automatically applied during this verification step.**

### Get Wallet Balance

```http
GET /api/wallets/{estateId}/balance
Authorization: Bearer {token}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "estateId": "estate_id",
    "marketing": {
      "balance": 500000,
      "percentage": 50
    },
    "owner": {
      "balance": 300000,
      "percentage": 30
    },
    "operations": {
      "balance": 200000,
      "percentage": 20
    },
    "totalReceived": 1000000,
    "totalBalance": 1000000
  }
}
```

### Get Distribution History

```http
GET /api/wallets/{estateId}/history
Authorization: Bearer {token}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "marketing": [
      {
        "paymentId": "payment_id",
        "amount": 50000,
        "description": "rent distribution (50%)",
        "createdAt": "2024-01-01T10:00:00Z"
      }
    ],
    "owner": [...],
    "operations": [...]
  }
}
```

## Logging

All distributions are logged with detailed information:

```
🎯 Global 50/30/20 Distribution Applied
- Payment Type: rent
- Amount: ₦100,000
- Marketing: ₦50,000 (50%)
- Owner: ₦30,000 (30%)
- Operations: ₦20,000 (20%)
- Timestamp: [date]
- Payment Reference: [ref]
```

## Database Structure

### WalletAccount Model

Each estate has one WalletAccount tracking:

```
{
  estate: ObjectId,
  marketingBalance: Number,
  marketingDistributions: [{
    paymentId: ObjectId,
    amount: Number,
    description: String,
    createdAt: Date
  }],
  ownerBalance: Number,
  ownerDistributions: [...],
  operationsBalance: Number,
  operationsDistributions: [...],
  totalReceived: Number,
  lastUpdated: Date,
  updatedBy: ObjectId
}
```

## Testing the Distribution

### Test 1: Verify distribution on rent payment

```bash
# 1. Initiate rent payment
POST /api/payments/rent
{
  "tenantId": "test_tenant_id",
  "amount": 100000
}

# 2. Complete payment on Paystack

# 3. Verify payment (triggers distribution)
GET /api/payments/verify/{paystack_reference}

# 4. Check wallet balance
GET /api/wallets/{estate_id}/balance
# Should show: marketing=50000, owner=30000, operations=20000

# 5. Check distribution history
GET /api/wallets/{estate_id}/history
# Should show transaction details
```

### Test 2: Verify distribution on deposit payment

```bash
# Same flow but with deposit payment type
POST /api/payments/deposit
{
  "tenantId": "test_tenant_id",
  "amount": 50000
}

# After verification, wallet should have:
# marketing += 25000, owner += 15000, operations += 10000
```

### Test 3: Multiple payments

Make multiple payments of different types. Wallet balances should accumulate:

```
Payment 1: Rent ₦100,000 → marketing +50k, owner +30k, ops +20k
Payment 2: Deposit ₦50,000 → marketing +25k, owner +15k, ops +10k
Payment 3: Service Charge ₦30,000 → marketing +15k, owner +9k, ops +6k

Total: marketing=90k, owner=54k, operations=36k
```

## Error Handling

If distribution fails (unlikely):
- Payment is still marked as completed
- Distribution error is logged but doesn't block payment
- System can retry distribution manually
- Manual verification available in wallet history

## Future Enhancements

- [ ] Batch processing for multiple payments
- [ ] Scheduled automated withdrawals
- [ ] Real-time dashboard with distribution metrics
- [ ] Custom distribution rules per estate (if needed)
- [ ] Integration with accounting system

## Important Notes

1. **Automatic on Verification**: Distribution happens automatically when payment is verified by Paystack
2. **All Payment Types**: Distribution applies uniformly to all payment types
3. **Per-Estate Tracking**: Each estate has its own wallet account with separate balances
4. **Audit Trail**: All distributions are logged with payment references for accountability
5. **Immutable Records**: Distribution history cannot be modified after creation

---

**Last Updated**: January 2024
**Version**: 1.0
**Status**: ✅ Production Ready
