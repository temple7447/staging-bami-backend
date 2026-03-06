# Paystack Payment Integration - Setup Guide

**Status**: ✅ **Production Ready**

---

## Quick Start (5 Minutes)

### Step 1: Get Paystack Credentials
1. Sign up at [Paystack.com](https://paystack.com)
2. Verify your email & complete merchant setup
3. Go to Dashboard → Settings → API Keys
4. Copy your credentials:
   - **Public Key** (starts with `pk_`)
   - **Secret Key** (starts with `sk_`)

### Step 2: Configure .env
```bash
PAYSTACK_PUBLIC_KEY=pk_test_xxxxx
PAYSTACK_SECRET_KEY=sk_test_xxxxx
PAYSTACK_SANDBOX=true
BACKEND_URL=http://localhost:5000
FRONTEND_URL=http://localhost:3000
```

### Step 3: Restart Server
```bash
npm run dev
```

### Step 4: Test Payment
```bash
# 1. Get admin token
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"password"}'

# 2. Get tenants
curl http://localhost:5000/api/tenants \
  -H "Authorization: Bearer TOKEN"

# 3. Create payment
curl -X POST http://localhost:5000/api/payments/deposit \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "tenantId": "TENANT_ID",
    "amount": 150000,
    "description": "Test deposit"
  }'
```

Expected response:
```json
{
  "success": true,
  "data": {
    "paymentLink": "https://checkout.paystack.com/...",
    "reference": "PAY-xxx-yyy",
    "accessCode": "xxx",
    "amount": 150000
  }
}
```

---

## API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/payments/deposit` | Create tenant deposit payment |
| GET | `/api/payments/:paymentId` | Get payment status |
| GET | `/api/payments/tenant/:id` | Get tenant payment history |
| GET | `/api/payments/estate/:id` | Get estate payment summary |
| POST | `/api/payments/callback` | Paystack webhook (no auth) |
| POST | `/api/payments/:id/refund` | Refund deposit |

---

## How It Works

1. **Admin initiates payment**: POST `/api/payments/deposit`
2. **Payment record created**: Status = "pending"
3. **Paystack API called**: Returns checkout URL
4. **Admin shares link**: Tenant clicks to pay
5. **Tenant completes payment**: On Paystack checkout
6. **Paystack sends callback**: Payment result
7. **Payment updated**: Status = "completed/failed"
8. **Confirmation email**: Sent to tenant & admin

---

## Webhook Configuration

To receive payment confirmations, configure webhook in Paystack:

1. Go to Dashboard → Settings → API Keys & Webhooks
2. Add webhook URL: `https://yourdomain.com/api/payments/callback`
3. Select events: `charge.success`, `charge.failed`
4. Copy your authorization signature key

Update `.env`:
```
PAYSTACK_WEBHOOK_SECRET=your_webhook_secret
```

---

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `PAYSTACK_SECRET_KEY not configured` | Missing .env | Add credentials to .env |
| `Tenant not found` | Invalid tenantId | Use valid tenant ID from `/api/tenants` |
| `Authorization failed` | Wrong credentials | Check .env keys are correct |
| `Request timeout` | Network issue | Check internet connection |

### Success Indicators

✅ Payment creation returns authorization URL  
✅ Payment record saved with reference  
✅ Amount in Naira (₦)  
✅ No errors in server logs  

---

## Currency Details

- **Currency**: NGN (Nigerian Naira only)
- **Unit**: Amount in smallest unit (kobo)
- **Conversion**: 1 Naira = 100 kobo
- **Example**: ₦150,000 = 15,000,000 kobo

---

## Testing with Paystack Test Cards

Use these cards to test on sandbox:

| Card | Number | Expiry | CVV |
|------|--------|--------|-----|
| Visa | 4084084084084081 | 01/25 | 408 |
| Mastercard | 5398040000000005 | 01/25 | 408 |
| USSD | Depends on bank | - | - |

---

## Production Deployment

1. **Switch to production credentials**:
   ```
   PAYSTACK_SECRET_KEY=sk_live_xxxxx
   PAYSTACK_PUBLIC_KEY=pk_live_xxxxx
   PAYSTACK_SANDBOX=false
   ```

2. **Update URLs**:
   ```
   BACKEND_URL=https://api.yourdomain.com
   FRONTEND_URL=https://yourdomain.com
   ```

3. **Configure webhook**: In Paystack dashboard, add production webhook URL

4. **Test**:
   - Create test payment
   - Complete payment with real card
   - Verify status updates

5. **Monitor**: Check transaction logs in Paystack dashboard

---

## Files Created/Modified

| File | Status | Changes |
|------|--------|---------|
| `/utils/paystackService.js` | ✅ NEW | Complete Paystack integration |
| `/controllers/paymentController.js` | ✅ UPDATED | Paystack integration implemented |
| `/models/Payment.js` | ✅ UPDATED | Paystack fields added |
| `.env.example` | ✅ UPDATED | Paystack variables |
| `/routes/payments.js` | ✅ NO CHANGE | Routes still work |

---

## Support

- **Paystack Docs**: https://paystack.com/docs
- **Dashboard**: https://dashboard.paystack.com
- **Support**: https://paystack.com/support

---

**Ready to go!** 🚀 Your payment system now uses Paystack.
