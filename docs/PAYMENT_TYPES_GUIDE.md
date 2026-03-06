# BamiHustle Payment Types - Complete Guide

**Status**: ✅ **Production Ready**

---

## Overview

The BamiHustle backend now supports **6 different payment types** for tenant transactions. Each payment type is handled through the Paystack payment gateway and can be initiated by admin users on behalf of tenants.

---

## Supported Payment Types

### 1. **Deposit** 🎁
- **Endpoint**: `POST /api/payments/deposit`
- **Description**: Initial security deposit payment from tenant
- **Refundable**: Yes (tracked via `isDeposit: true`)
- **Use Case**: Required when tenant first moves into property
- **Example**: ₦500,000 deposit for securing unit

### 2. **Rent** 💵
- **Endpoint**: `POST /api/payments/rent`
- **Description**: Monthly/periodic rent payment
- **Refundable**: No
- **Use Case**: Regular monthly rent collection
- **Example**: ₦150,000 monthly rent

### 3. **Service Charge** 🔧
- **Endpoint**: `POST /api/payments/service-charge`
- **Description**: Maintenance and facility service fees
- **Refundable**: No
- **Use Case**: Maintenance of common areas, security services
- **Example**: ₦25,000 monthly service charge

### 4. **Caution Fee** ⚠️
- **Endpoint**: `POST /api/payments/caution-fee`
- **Description**: One-time caution/cautionary deposit
- **Refundable**: Yes (can be refunded upon lease termination)
- **Use Case**: Additional security held for tenant behavior
- **Example**: ₦100,000 one-time caution fee

### 6. **Legal Fee** ⚖️
- **Endpoint**: `POST /api/payments/legal-fee`
- **Description**: Legal documentation and agreement fees
- **Refundable**: No
- **Use Case**: Processing lease agreements, legal documents
- **Example**: ₦20,000 one-time legal fee

---

## API Endpoints

### Request Format (All Payment Types)

```bash
curl -X POST http://localhost:5000/api/payments/{payment-type} \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "507f1f77bcf86cd799439011",
    "amount": 150000,
    "description": "October 2024 rent payment"
  }'
```

### Request Body

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `tenantId` | String (ObjectId) | ✅ Yes | Tenant's unique MongoDB ID |
| `amount` | Number | ✅ Yes | Amount in Naira (NGN) |
| `description` | String | ❌ No | Custom payment description |

### Success Response (201)

```json
{
  "success": true,
  "message": "Rent payment initiated successfully",
  "data": {
    "paymentId": "507f1f77bcf86cd799439012",
    "paymentLink": "https://checkout.paystack.com/...",
    "reference": "PAY-1699617234-abc123",
    "accessCode": "zpf1e2xp38",
    "amount": 150000,
    "type": "rent",
    "tenant": {
      "name": "John Doe",
      "unit": "A1"
    }
  }
}
```

### Error Response (400/500)

```json
{
  "success": false,
  "message": "Failed to initiate payment",
  "error": "Tenant not found"
}
```

---

## Example Requests

### Deposit Payment
```bash
POST /api/payments/deposit
{
  "tenantId": "507f1f77bcf86cd799439011",
  "amount": 500000,
  "description": "Security deposit for unit A1"
}
```

### Rent Payment
```bash
POST /api/payments/rent
{
  "tenantId": "507f1f77bcf86cd799439011",
  "amount": 150000,
  "description": "November 2024 rent payment"
}
```

### Service Charge
```bash
POST /api/payments/service-charge
{
  "tenantId": "507f1f77bcf86cd799439011",
  "amount": 25000
}
```

### Security Charge
```bash
POST /api/payments/security-charge
{
  "tenantId": "507f1f77bcf86cd799439011",
  "amount": 15000,
  "description": "November 2024 security charge"
}
```

### Caution Fee
```bash
POST /api/payments/caution-fee
{
  "tenantId": "507f1f77bcf86cd799439011",
  "amount": 100000,
  "description": "One-time caution fee"
}
```

### Legal Fee
```bash
POST /api/payments/legal-fee
{
  "tenantId": "507f1f77bcf86cd799439011",
  "amount": 20000,
  "description": "Lease agreement legal processing"
}
```

---

## Payment Workflow

For **all payment types**, the workflow is identical:

1. **Admin Initiates Payment**
   - Admin calls payment endpoint with tenant ID and amount
   - Server creates payment record in database (status: "initiated")

2. **Paystack Checkout Created**
   - Paystack API generates unique payment reference
   - Authorization URL returned to admin

3. **Payment Link Shared**
   - Admin shares Paystack checkout link with tenant
   - Tenant completes payment on Paystack platform

4. **Payment Verification**
   - Paystack callback received (webhook)
   - Payment status updated to "completed" or "failed"

5. **Confirmation Email**
   - Admin receives confirmation email
   - Payment record updated with Paystack transaction details

---

## Database Fields

All payments are stored with these fields:

| Field | Type | Description |
|-------|------|-------------|
| `tenant` | ObjectId | Reference to Tenant |
| `estate` | ObjectId | Reference to Estate |
| `admin` | ObjectId | Admin who initiated payment |
| `paymentType` | String | Type: deposit, rent, service_charge, caution_fee, legal_fee |
| `amount` | Number | Amount in NGN |
| `currency` | String | Always 'NGN' |
| `description` | String | Payment description |
| `paymentStatus` | String | pending, initiated, completed, failed, refunded |
| `paystackReference` | String | Unique Paystack transaction reference |
| `isDeposit` | Boolean | True for deposit/caution_fee types |
| `createdAt` | Date | Created timestamp |
| `paymentDate` | Date | Actual payment completion date |

---

## Payment Type Classifications

### By Refundability

**Refundable** (Can be refunded):
- Deposit
- Caution Fee

**Non-Refundable**:
- Rent
- Service Charge
- Legal Fee

### By Frequency

**One-Time Payments**:
- Deposit
- Caution Fee
- Legal Fee

**Recurring Payments**:
- Rent (monthly/periodic)
- Service Charge (monthly/periodic)

### By Amount Range (Typical)

| Type | Min | Typical | Max |
|------|-----|---------|-----|
| Deposit | ₦200,000 | ₦500,000 | ₦2,000,000 |
| Rent | ₦50,000 | ₦150,000 | ₦500,000 |
| Service Charge | ₦5,000 | ₦25,000 | ₦100,000 |
| Caution Fee | ₦100,000 | ₦250,000 | ₦1,000,000 |
| Legal Fee | ₦10,000 | ₦20,000 | ₦50,000 |

---

## Query Payment Status

Get status of any payment:

```bash
GET /api/payments/{paymentId}

Response:
{
  "success": true,
  "data": {
    "paymentId": "507f1f77bcf86cd799439012",
    "status": "completed",
    "amount": 150000,
    "type": "rent",
    "createdAt": "2024-11-10T19:35:23Z",
    "paymentDate": "2024-11-10T19:45:00Z",
    "tenant": { ... },
    "estate": { ... }
  }
}
```

---

## Get Tenant Payment History

List all payments for a specific tenant:

```bash
GET /api/payments/tenant/{tenantId}?page=1&limit=20&status=completed

Response:
{
  "success": true,
  "data": [
    {
      "paymentId": "...",
      "type": "rent",
      "amount": 150000,
      "status": "completed",
      "isDeposit": false,
      "createdAt": "2024-11-10T19:35:23Z",
      "paymentDate": "2024-11-10T19:45:00Z"
    },
    {
      "paymentId": "...",
      "type": "service_charge",
      "amount": 25000,
      "status": "completed",
      "isDeposit": false,
      "createdAt": "2024-11-09T10:20:00Z",
      "paymentDate": "2024-11-09T10:30:00Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 3,
    "totalItems": 45
  }
}
```

Query Parameters:
- `page`: Page number (default: 1)
- `limit`: Items per page (default: 20)
- `status`: Filter by status (pending, completed, failed, etc.)

---

## Get Estate Payment Summary

Get all payments for an estate with summary:

```bash
GET /api/payments/estate/{estateId}?type=rent

Response:
{
  "success": true,
  "data": [
    {
      "paymentId": "...",
      "tenant": "John Doe",
      "unit": "A1",
      "type": "rent",
      "amount": 150000,
      "status": "completed",
      "createdAt": "2024-11-10T19:35:23Z"
    }
  ],
  "summary": {
    "totalAmount": 1500000,
    "completedPayments": 15
  },
  "pagination": {
    "currentPage": 1,
    "totalPages": 2,
    "totalItems": 25
  }
}
```

---

## Refund Deposit

Only deposits and caution fees can be refunded:

```bash
POST /api/payments/{paymentId}/refund

Response:
{
  "success": true,
  "message": "Refund processed successfully",
  "data": {
    "refundNo": "REF-...",
    "amount": 500000
  }
}
```

---

## Implementation Details

### File Structure

| File | Purpose |
|------|---------|
| `/models/Payment.js` | Defines payment schema with all types |
| `/controllers/paymentController.js` | Handles all payment logic |
| `/routes/payments.js` | Routes for all payment endpoints |
| `/utils/paystackService.js` | Paystack integration |

### Code Architecture

```
initiatePaymentGeneric(paymentType, isDeposit)
├── Validates tenant & amount
├── Creates payment record
├── Calls Paystack API
├── Updates payment with reference
├── Sends confirmation email
└── Returns checkout URL

Specific handlers:
├── initiateDepositPayment
├── initiateRentPayment
├── initiateServiceChargePayment
├── initiateCautionFeePayment
└── initiateLegalFeePayment
```

### Payment Type Enum

```javascript
paymentType: {
  enum: [
    'deposit',
    'rent',
    'service_charge',
    'caution_fee',
    'legal_fee',
    'utilities',
    'maintenance',
    'other'
  ]
}
```

---

## Best Practices

✅ **Do:**
- Always validate tenant exists before initiating payment
- Include meaningful descriptions for tracking
- Use consistent amount formats (whole numbers in NGN)
- Check payment status after 5 minutes for completion
- Send reminder emails for pending payments

❌ **Don't:**
- Initiate duplicate payments for same tenant in short timeframe
- Use negative or zero amounts
- Forget to handle payment failures gracefully
- Store payment amounts in kobo (use NGN directly)

---

## Testing

### Test with Sandbox Cards

Use these cards for testing:
- **Visa**: 4084084084084081 (CVV: 408, Expiry: 01/25)
- **Mastercard**: 5398040000000005 (CVV: 408, Expiry: 01/25)

### Test All Payment Types

```bash
# Test Deposit
curl -X POST http://localhost:5000/api/payments/deposit \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"...", "amount":500000}'

# Test Rent
curl -X POST http://localhost:5000/api/payments/rent \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"...", "amount":150000}'

# Test Service Charge
curl -X POST http://localhost:5000/api/payments/service-charge \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"...", "amount":25000}'

# Test Security Charge
curl -X POST http://localhost:5000/api/payments/security-charge \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"...", "amount":15000}'

# Test Caution Fee
curl -X POST http://localhost:5000/api/payments/caution-fee \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"...", "amount":100000}'

# Test Legal Fee
curl -X POST http://localhost:5000/api/payments/legal-fee \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"tenantId":"...", "amount":20000}'
```

---

## Troubleshooting

### Payment Fails with "Tenant not found"
- Verify tenant ID is valid
- Check tenant is marked as active

### Paystack Endpoint Returns Error
- Verify PAYSTACK_SECRET_KEY is configured
- Check PAYSTACK_SANDBOX is set correctly
- Ensure amount is in NGN (not kobo)

### Payment Appears Multiple Times
- Check for duplicate requests
- Verify paymentId is unique
- Review payment history for tenant

### Refund Fails
- Verify payment type is deposit or caution_fee
- Check payment was marked completed
- Ensure deposit hasn't already been refunded

---

## Currency & Amounts

- **Currency**: NGN (Nigerian Naira)
- **Amount Unit**: Full Naira (e.g., 150000 = ₦150,000)
- **Paystack Conversion**: Amounts are multiplied by 100 for Paystack API (kobo)
- **Display Format**: `₦150,000.00` (formatted en-NG locale)

---

## Production Deployment

1. Update `.env` with production Paystack credentials
2. Set `PAYSTACK_SANDBOX=false`
3. Configure webhook URL in Paystack dashboard
4. Test all payment types with real transactions
5. Monitor payment completion rates

---

## Support & Reference

- **Paystack Docs**: https://paystack.com/docs/payments/
- **Payment Model**: `/models/Payment.js`
- **Payment Controller**: `/controllers/paymentController.js`
- **Paystack Service**: `/utils/paystackService.js`
- **Setup Guide**: `/PAYSTACK_SETUP_GUIDE.md`

---

**Version**: 1.0.0  
**Status**: ✅ Production Ready  
**Last Updated**: November 2024
