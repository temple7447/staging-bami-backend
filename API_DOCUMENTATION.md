# BamiHustle API Documentation

## Access Swagger UI

**Development:**
- URL: `http://localhost:5000/api-docs`
- Full interactive API documentation with try-it-out functionality

**Production:**
- URL: `https://bamihost.com/api-docs`

---

## API Overview

### Base URLs
- **Development:** `http://localhost:5000`
- **Production:** `https://bamihost.com`

### Authentication
All endpoints require JWT Bearer token in the Authorization header:
```
Authorization: Bearer YOUR_JWT_TOKEN
```

---

## Complete Endpoint List

**Total Endpoints:** 38
- Auth: 14
- Estates: 6
- Units: 3
- Tenants: 4
- Payments: 7
- Estate Wallet (Distribution): 7
- User Wallet: 4
- Upload: 2

## API Endpoints Summary

### 🔐 Authentication (14 endpoints)
- **POST** `/api/auth/register-super-admin` - Register a super admin
- **POST** `/api/auth/login` - Login and get JWT token
- **GET** `/api/auth/logout` - Logout current user
- **GET** `/api/auth/me` - Get current user details
- **PUT** `/api/auth/updatedetails` - Update user profile
- **PUT** `/api/auth/updatepassword` - Update password
- **POST** `/api/auth/forgotpassword` - Request password reset via email
- **POST** `/api/auth/forgotpassword-otp` - Request OTP for password reset
- **POST** `/api/auth/verify-otp` - Verify OTP
- **POST** `/api/auth/resetpassword-otp` - Reset password with OTP
- **POST** `/api/auth/create-admin` - Create new admin (Super Admin only)
- **GET** `/api/auth/admins` - List all admins (Super Admin only)
- **PUT** `/api/auth/admin/{id}/status` - Update admin status (Super Admin only)
- **DELETE** `/api/auth/admin/{id}` - Delete admin (Super Admin only)

### 🏢 Estates
- **GET** `/api/estates` - List all estates (paginated)
- **POST** `/api/estates` - Create new estate
- **GET** `/api/estates/{id}` - Get estate details
- **PUT** `/api/estates/{id}` - Update estate
- **DELETE** `/api/estates/{id}` - Delete estate (soft delete)
- **GET** `/api/estates/{id}/overview` - Get estate overview with statistics

### 🏠 Units
- **GET** `/api/estates/{estateId}/units` - List all units for estate
- **POST** `/api/estates/{estateId}/units` - Create new unit
- **GET** `/api/estates/{estateId}/units/vacant` - Get vacant units only
- **GET** `/api/estates/public/listings` - List all vacant properties (Public, No Auth)
- **GET** `/api/estates/public/listings/{id}` - Get property details (Public, No Auth)
- **DELETE** `/api/estates/unit/{id}` - Delete a unit (soft delete)

### 👥 Tenants
- **GET** `/api/estates/{estateId}/tenants` - List tenants for estate
- **POST** `/api/estates/{estateId}/tenants` - Create tenant and assign to unit
- **GET** `/api/tenants/{id}` - Get tenant details (with optional history/transactions)
- **PUT** `/api/tenants/{id}` - Update tenant information

### 💳 Payments
- **POST** `/api/payments/rent` - Initiate rent payment
- **POST** `/api/payments/deposit` - Initiate deposit payment
- **POST** `/api/payments/service-charge` - Initiate service charge payment
- **POST** `/api/payments/security-charge` - Initiate security charge payment
- **POST** `/api/payments/caution-fee` - Initiate caution fee payment
- **POST** `/api/payments/legal-fee` - Initiate legal fee payment
- **GET** `/api/payments/verify/{reference}` - Verify payment with Paystack
- **GET** `/api/payments/{paymentId}` - Get payment details
- **GET** `/api/payments/tenant/{tenantId}` - Get tenant payment history
- **GET** `/api/payments/estate/{estateId}` - Get estate payment history

### 💰 Estate Wallet & Account Distribution (7 endpoints)
- **GET** `/api/estates/{estateId}/wallet/balance` - Get all account balances
  - Marketing & Investment: 50%
  - Owner Withdraw: 30%
  - Operations & Maintenance: 20%
- **GET** `/api/estates/{estateId}/wallet/history` - Get distribution history
- **GET** `/api/estates/{estateId}/wallet/marketing` - Get marketing account (50%)
- **GET** `/api/estates/{estateId}/wallet/owner` - Get owner account (30%)
- **GET** `/api/estates/{estateId}/wallet/operations` - Get operations account (20%)
- **POST** `/api/estates/{estateId}/wallet/withdraw` - Withdraw from owner account

### 💳 User Wallet Management (4 endpoints)
- **GET** `/api/wallet` - Get user's wallet
- **POST** `/api/wallet` - Create new wallet
- **POST** `/api/wallet/add-funds` - Add funds to wallet
- **POST** `/api/wallet/deduct-funds` - Deduct funds from wallet

### 📤 File Upload (2 endpoints)
- **POST** `/api/upload/image` - Upload image to Cloudinary (JPEG, PNG, GIF, WebP, SVG - max 10MB)
- **POST** `/api/upload/video` - Upload video to Cloudinary (MP4, WebM, MOV, AVI, MKV, 3GP - max 200MB)

---

## Common Request/Response Examples

### Create a Unit
```json
POST /api/estates/{estateId}/units
Content-Type: application/json
Authorization: Bearer {token}

{
  "label": "Unit 1",
  "monthlyPrice": 40000,
  "meterNumber": "EN-12232323",
  "description": "Modern Penthouse with ocean view",
  "category": "Penthouse",
  "listingType": "Rent",
  "securityDeposit": 200000,
  "serviceChargeMonthly": 5000,
  "cautionFee": 50000,
  "legalFee": 30000,
  "availableDate": "2026-02-01",
  "bedrooms": 3,
  "bathrooms": 3,
  "area": 2500,
  "streetAddress": "123 Luxury Lane, Victoria Island",
  "amenities": {
    "wifi": true,
    "pool": true,
    "gym": true,
    "parking": true,
    "ac": true,
    "security": true,
    "petFriendly": false,
    "balcony": true,
    "laundry": true
  },
  "images": [
    "https://res.cloudinary.com/.../image1.jpg",
    "https://res.cloudinary.com/.../image2.jpg"
  ]
}
```

### Create a Tenant (Assigned to Unit)
```json
POST /api/estates/{estateId}/tenants
Content-Type: application/json
Authorization: Bearer {token}

{
  "unitId": "69134b6447a188919b2fcede",
  "tenantName": "John Doe",
  "tenantEmail": "john@gmail.com",
  "tenantPhone": "08012345678",
  "tenantType": "new",
  "nextDueDate": "2026-01-11"
}
```

### Initiate Rent Payment
```json
POST /api/payments/rent
Content-Type: application/json
Authorization: Bearer {token}

{
  "tenantId": "6913668aa285e8c101111eee",
  "amount": 40000,
  "description": "Monthly rent for Unit 1"
}
```

### Verify Payment
```
GET /api/payments/verify/PAYMENT_REFERENCE
Authorization: Bearer {token}
```

### Get Wallet Balance
```
GET /api/estates/690cf9cf00208ba6b1561010/wallet/balance
Authorization: Bearer {token}
```

Response:
```json
{
  "success": true,
  "data": {
    "estateId": "690cf9cf00208ba6b1561010",
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
    "totalBalance": 1000000,
    "totalReceived": 1000000,
    "lastUpdated": "2025-11-11T17:00:00.000Z"
  }
}
```

### Withdraw from Owner Account
```json
POST /api/estates/{estateId}/wallet/withdraw
Content-Type: application/json
Authorization: Bearer {token}

{
  "amount": 50000,
  "reason": "Monthly operations funding"
}
```

---

## Error Responses

All errors follow this format:
```json
{
  "success": false,
  "message": "Error description",
  "error": "Detailed error information"
}
```

### Common Status Codes
- **200** - Success
- **201** - Created successfully
- **400** - Bad request / Validation error
- **401** - Unauthorized (missing/invalid token)
- **403** - Forbidden (insufficient permissions)
- **404** - Resource not found
- **409** - Conflict (e.g., duplicate entry)
- **500** - Server error

---

## Testing the API

1. Open Swagger UI: `http://localhost:5000/api-docs`
2. Click the "Authorize" button
3. Enter your JWT token: `Bearer YOUR_TOKEN`
4. Try out endpoints directly from the UI
5. All responses will be shown with proper formatting

---

## Account Distribution Workflow

When a payment is completed:
1. ✅ Payment verified with Paystack
2. ✅ Amount automatically distributed:
   - **50%** → Marketing & Investment account
   - **30%** → Owner Withdraw account
   - **20%** → Operations & Maintenance account
3. ✅ Distribution tracked in wallet history
4. ✅ Owner can withdraw from their account anytime

---

## Rate Limiting
- **Window:** 15 minutes
- **Max Requests:** 100 per window
- **Per IP:** Limits applied per client IP

---

## Logging
During development, all errors are logged with:
- ❌ Error type and message
- 📋 Request context
- 📌 Error code and details
- 📚 Full stack trace (when available)

---

## Support
For API support, contact: `support@bamihustle.com`
