# BamiHustle API Documentation

Base URL: `http://localhost:4000/api`

All endpoints require authentication via Bearer token in the `Authorization` header unless marked as **Public**.

```
Authorization: Bearer <your_jwt_token>
```

---

# TABLE OF CONTENTS

1. [Authentication](#1-authentication)
2. [Tenant "Me" Endpoints](#2-tenant-me-endpoints)
3. [Tenant Management](#3-tenant-management)
4. [Billing](#4-billing)
5. [Payments](#5-payments)
6. [Wallet & Transactions](#6-wallet--transactions)
7. [Dashboard](#7-dashboard)
8. [Service Requests](#8-service-requests)
9. [Estate Management](#9-estate-management)
10. [Unit Management](#10-unit-management)

---

## 1. Authentication

### 1.1 Login

**`POST /api/auth/login`**

**Access:** Public

**Request Body:**
```json
{
  "email": "tenant@test.com",
  "password": "TempPass123"
}
```

**Response (200):**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "user_id",
    "name": "Test Tenant",
    "email": "tenant@test.com",
    "role": "tenant",
    "isActive": true,
    "emailVerified": true
  }
}
```

### 1.2 Get My Profile

**`GET /api/auth/me`**

**Access:** All roles

**Response (200):**
```json
{
  "success": true,
  "data": {
    "id": "user_id",
    "name": "Test Tenant",
    "email": "tenant@test.com",
    "role": "tenant",
    "walletBalance": 120000,
    "phone": "08012345678",
    "isActive": true,
    "createdAt": "2024-01-01T00:00:00.000Z"
  }
}
```

### 1.3 Update My Details

**`PUT /api/auth/updatedetails`**

**Access:** All roles

**Request Body:**
```json
{
  "name": "Updated Name",
  "phone": "08098765432"
}
```

### 1.4 Update My Password

**`PUT /api/auth/updatepassword`**

**Access:** All roles

**Request Body:**
```json
{
  "currentPassword": "OldPass123!",
  "newPassword": "NewPass123!"
}
```

### 1.5 Upload My Avatar

**`PUT /api/auth/me/avatar`** or **`POST /api/auth/me/avatar`**

**Access:** All roles

**Request:** Multipart form with `file` field (image, max 10MB)

### 1.6 Forgot Password (OTP)

**`POST /api/auth/forgotpassword-otp`**

**Access:** Public

**Request Body:**
```json
{
  "email": "tenant@test.com"
}
```

### 1.7 Verify OTP

**`POST /api/auth/verify-otp`**

**Access:** Public

**Request Body:**
```json
{
  "email": "tenant@test.com",
  "code": "123456"
}
```

### 1.8 Reset Password with OTP

**`POST /api/auth/resetpassword-otp`**

**Access:** Public

**Request Body:**
```json
{
  "email": "tenant@test.com",
  "code": "123456",
  "password": "NewPass123!"
}
```

---

## 2. Tenant "Me" Endpoints

Endpoints for the logged-in tenant user.

### 2.1 Get My Billing Items

**`GET /api/tenants/me/billing`**

**Access:** Tenant role

**Description:** Returns all billing items (recurring, one-time, optional) for the logged-in tenant.

**Response (200):**
```json
{
  "success": true,
  "data": {
    "recurring": [
      {
        "code": "rent",
        "label": "Rent",
        "amount": 500000,
        "type": "recurring",
        "frequency": "monthly"
      },
      {
        "code": "service_charge",
        "label": "Service Charge",
        "amount": 50000,
        "type": "recurring",
        "frequency": "monthly"
      }
    ],
    "oneTime": [
      {
        "code": "caution_fee",
        "label": "Caution Fee",
        "amount": 100000,
        "type": "one_time"
      },
      {
        "code": "legal_fee",
        "label": "Legal Fee",
        "amount": 50000,
        "type": "one_time"
      }
    ],
    "optional": []
  }
}
```

### 2.2 Pay Selected Billing Items

**`POST /api/tenants/me/billing/pay`**

**Access:** Tenant role

**Description:** Initialize Paystack payment for selected billing items.

**Request Body:**
```json
{
  "itemIds": ["rent", "service_charge"]
}
```

**Response (200):**
```json
{
  "success": true,
  "message": "Payment initialized successfully",
  "data": {
    "authorizationUrl": "https://checkout.paystack.com/...",
    "accessCode": "access_code_here",
    "reference": "billing_userId_timestamp",
    "amount": 550000,
    "items": [
      { "code": "rent", "label": "Rent", "amount": 500000 },
      { "code": "service_charge", "label": "Service Charge", "amount": 50000 }
    ]
  }
}
```

### 2.3 Get My Tenant History

**`GET /api/tenants/me/history`**

**Access:** Tenant role

**Description:** Get history events for the logged-in tenant.

**Response (200):**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "event": "created",
      "note": "Tenant record created",
      "createdAt": "2024-01-01T00:00:00.000Z"
    },
    {
      "event": "payment",
      "note": "Rent payment received",
      "meta": { "amount": 500000 },
      "createdAt": "2024-06-01T00:00:00.000Z"
    }
  ]
}
```

---

## 3. Tenant Management

### 3.1 List Tenants

**`GET /api/tenants`**

**Access:** Protected

**Query Parameters:**

| Param | Default | Description |
|---|---|---|
| `page` | 1 | Page number |
| `limit` | 20 | Items per page |
| `search` | - | Search by name, email, phone |
| `estate` | - | Filter by estate ID |
| `view` | - | `quarterly` for quarterly view |
| `year` | - | Filter by year |
| `quarter` | - | `Q1`, `Q2`, `Q3`, `Q4`, `6_months` |

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "_id": "tenant_id",
      "tenantName": "John Doe",
      "tenantEmail": "john@example.com",
      "tenantPhone": "08012345678",
      "rentAmount": 500000,
      "serviceChargeAmount": 50000,
      "nextDueDate": "2025-12-31T00:00:00.000Z",
      "status": "occupied",
      "unitLabel": "A1",
      "currentEffectiveRent": 500000,
      "daysUntilDue": 45
    }
  ],
  "summary": {
    "totalItems": 50,
    "totalMonthlyRent": 25000000
  },
  "pagination": {
    "currentPage": 1,
    "totalPages": 3,
    "totalItems": 50
  }
}
```

### 3.2 Get Tenant by ID

**`GET /api/tenants/:id`**

**Access:** Protected

**Query Parameters:**

| Param | Description |
|---|---|
| `expand` | Include `history` and/or `transactions` |
| `page` | Transactions page |
| `limit` | Transactions limit |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "tenant": {
      "_id": "tenant_id",
      "tenantName": "John Doe",
      "tenantEmail": "john@example.com",
      "estate": "estate_id",
      "unit": "unit_id",
      "unitLabel": "A1",
      "rentAmount": 500000,
      "serviceChargeAmount": 50000,
      "status": "occupied",
      "nextDueDate": "2025-12-31T00:00:00.000Z"
    },
    "overview": {
      "name": "John Doe",
      "rent": 500000,
      "serviceCharge": 50000,
      "cautionFee": 100000,
      "legalFee": 50000,
      "leaseDurationMonths": 12,
      "totalLeaseAmount": 6600000,
      "nextDue": "2025-12-31"
    },
    "financialSummary": {
      "totalPaid": 3000000,
      "paymentBreakdown": {
        "rent": { "total": 2000000, "count": 4 },
        "serviceCharge": { "total": 1000000, "count": 4 }
      }
    }
  }
}
```

### 3.3 Create Tenant

**`POST /api/tenants`**

**Access:** Protected

**Request Body:**
```json
{
  "unitId": "unit_mongodb_id",
  "tenantName": "John Doe",
  "firstName": "John",
  "surname": "Doe",
  "otherNames": "Middle",
  "tenantEmail": "john@example.com",
  "tenantPhone": "08012345678",
  "whatsapp": "08012345678",
  "tenantType": "new",
  "entryDate": "2024-01-15",
  "nextDueDate": "2025-01-15",
  "durationMonths": 12
}
```

**Response (201):**
```json
{
  "success": true,
  "message": "Tenant created successfully",
  "data": {
    "_id": "tenant_id",
    "tenantName": "John Doe",
    "tenantEmail": "john@example.com"
  }
}
```

### 3.4 Update Tenant

**`PUT /api/tenants/:id`**

**Access:** Protected

**Request Body:** (all fields optional)
```json
{
  "tenantName": "John Doe Jr",
  "tenantEmail": "john.jr@example.com",
  "rentAmount": 550000,
  "serviceChargeAmount": 55000,
  "status": "occupied",
  "entryDate": "2024-01-15",
  "nextDueDate": "2025-01-15"
}
```

### 3.5 Delete Tenant (Soft Delete)

**`DELETE /api/tenants/:id`**

**Access:** Protected

**Response (200):**
```json
{
  "success": true,
  "message": "Tenant deleted successfully"
}
```

### 3.6 Upload Tenant Avatar

**`POST /api/tenants/:id/avatar`**

**Access:** Protected (Admin/Super Admin OR the tenant themselves)

**Request:** Multipart form with `file` field (image, max 10MB)

**Response (200):**
```json
{
  "success": true,
  "message": "Profile image updated",
  "data": {
    "url": "https://res.cloudinary.com/...",
    "public_id": "avatars/..."
  }
}
```

### 3.7 Get Tenant History

**`GET /api/tenants/:id/history`**

**Access:** Protected

**Response (200):**
```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "event": "created",
      "note": "Tenant record created",
      "createdAt": "2024-01-01T00:00:00.000Z"
    }
  ]
}
```

### 3.8 Add Tenant History Entry

**`POST /api/tenants/:id/history`**

**Access:** Protected

**Request Body:**
```json
{
  "event": "note",
  "note": "Rent payment received",
  "meta": { "amount": 500000 }
}
```

### 3.9 List Tenant Transactions

**`GET /api/tenants/:id/transactions`**

**Access:** Protected

**Query Parameters:** `page`, `limit`

**Response (200):**
```json
{
  "success": true,
  "count": 10,
  "data": [
    {
      "_id": "txn_id",
      "amount": 500000,
      "type": "rent",
      "method": "paystack",
      "status": "paid",
      "reference": "REF123",
      "periodMonth": 6,
      "periodYear": 2024,
      "createdAt": "2024-06-01T00:00:00.000Z"
    }
  ]
}
```

### 3.10 Record Transaction for Tenant

**`POST /api/tenants/:id/transactions`**

**Access:** Protected

**Request Body:**
```json
{
  "amount": 500000,
  "type": "rent",
  "method": "cash",
  "status": "paid",
  "reference": "REF123",
  "periodMonth": 6,
  "periodYear": 2024,
  "durationMonths": 12,
  "notes": "Annual rent payment"
}
```

### 3.11 Get Tenant Billing Items

**`GET /api/tenants/:id/billing`**

**Access:** Protected

**Response (200):** Same structure as [Get My Billing Items](#21-get-my-billing-items)

---

## 4. Billing

### 4.1 Create Billing Item for Tenant

**`POST /api/billing/tenants/:tenantId/billing`**

**Access:** Admin, Super Admin

**Request Body:**
```json
{
  "itemType": "maintenance",
  "label": "Plumbing Repair",
  "amount": 25000,
  "dueDate": "2024-06-15",
  "isRecurring": false,
  "frequency": "once"
}
```

### 4.2 Get Tenant Billing Items

**`GET /api/billing/tenants/:tenantId/billing`**

**Access:** Admin, Super Admin

**Response (200):**
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "_id": "billing_id",
      "itemType": "maintenance",
      "label": "Plumbing Repair",
      "amount": 25000,
      "dueDate": "2024-06-15T00:00:00.000Z",
      "isPaid": false,
      "isRecurring": false
    }
  ]
}
```

### 4.3 Update Billing Item

**`PUT /api/billing/:itemId`**

**Access:** Admin, Super Admin

**Request Body:**
```json
{
  "amount": 30000,
  "dueDate": "2024-07-01",
  "isPaid": false
}
```

### 4.4 Delete Billing Item

**`DELETE /api/billing/:itemId`**

**Access:** Admin, Super Admin

**Response (200):**
```json
{
  "success": true,
  "message": "Billing item deleted successfully"
}
```

---

## 5. Payments

### 5.1 Initialize Initial Payment (Multiple Items)

**`POST /api/payments/initial`**

**Access:** Protected

**Request Body:**
```json
{
  "tenantId": "tenant_id",
  "billingItems": [
    { "type": "rent", "amount": 500000, "duration": 12, "label": "Rent" },
    { "type": "service_charge", "amount": 50000, "duration": 12 }
  ]
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "authorizationUrl": "https://checkout.paystack.com/...",
    "accessCode": "access_code",
    "reference": "INIT-1714392000000",
    "amount": 6600000
  }
}
```

### 5.2 Initialize Deposit Payment

**`POST /api/payments/deposit`**

**Access:** Protected

**Request Body:**
```json
{
  "tenantId": "tenant_id",
  "amount": 500000
}
```

### 5.3 Initialize Rent Payment

**`POST /api/payments/rent`**

**Access:** Protected

**Request Body:**
```json
{
  "tenantId": "tenant_id",
  "durationMonths": 12
}
```

### 5.4 Initialize Service Charge Payment

**`POST /api/payments/service-charge`**

**Access:** Protected

**Request Body:**
```json
{
  "tenantId": "tenant_id",
  "durationMonths": 12
}
```

### 5.5 Initialize Caution Fee Payment

**`POST /api/payments/caution-fee`**

**Access:** Protected

**Request Body:**
```json
{
  "tenantId": "tenant_id"
}
```

### 5.6 Initialize Legal Fee Payment

**`POST /api/payments/legal-fee`**

**Access:** Protected

**Request Body:**
```json
{
  "tenantId": "tenant_id"
}
```

### 5.7 Verify Payment

**`GET /api/payments/verify/:reference`**

**Access:** Public (Paystack callback)

**Query Parameters:**

| Param | Description |
|---|---|
| `redirect` | Set `true` for browser redirect |

**Response (200):**
```json
{
  "success": true,
  "data": {
    "payment": {
      "paymentStatus": "completed",
      "amount": 500000,
      "paystackReference": "ref_123456"
    }
  }
}
```

### 5.8 Get Payment by ID

**`GET /api/payments/:paymentId`**

**Access:** Protected

**Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "payment_id",
    "paymentType": "rent",
    "amount": 500000,
    "paymentStatus": "completed",
    "paymentMethod": "paystack",
    "paystackReference": "ref_123456",
    "createdAt": "2024-06-01T00:00:00.000Z"
  }
}
```

### 5.9 Get Tenant Payments

**`GET /api/payments/tenant/:tenantId`**

**Access:** Protected

**Query Parameters:** `page`, `limit`, `status` (`completed`, `pending`, `failed`)

**Response (200):**
```json
{
  "success": true,
  "count": 5,
  "total": 10,
  "data": [
    {
      "_id": "payment_id",
      "paymentType": "rent",
      "amount": 500000,
      "paymentStatus": "completed",
      "createdAt": "2024-06-01T00:00:00.000Z"
    }
  ]
}
```

### 5.10 Get Estate Payments

**`GET /api/payments/estate/:estateId`**

**Access:** Protected

**Query Parameters:** `page`, `limit`

### 5.11 Record Manual Payment

**`POST /api/payments/manual-record`**

**Access:** Protected

**Request Body:**
```json
{
  "tenantId": "tenant_id",
  "paymentType": "rent",
  "amount": 500000,
  "paymentMethod": "cash",
  "paymentDate": "2024-06-15",
  "durationMonths": 12
}
```

### 5.12 Download Payment Receipt

**`GET /api/payments/:paymentId/download`**

**Access:** Protected

**Response:** PDF file download

### 5.13 Send Receipt by Payment ID

**`POST /api/payments/:paymentId/receipt`**

**Access:** Protected

**Response (200):**
```json
{
  "success": true,
  "message": "Receipt sent successfully"
}
```

### 5.14 Send Receipt by Tenant ID

**`POST /api/payments/tenant/:tenantId/receipt`**

**Access:** Protected

**Response (200):**
```json
{
  "success": true,
  "message": "Receipt sent successfully"
}
```

### 5.15 Refund Deposit

**`POST /api/payments/:paymentId/refund`**

**Access:** Protected

**Response (200):**
```json
{
  "success": true,
  "message": "Deposit refunded successfully"
}
```

---

## 6. Wallet & Transactions

### 6.1 Get Wallet Balance

**`GET /api/wallet`**

**Access:** All roles

**Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "wallet_id",
    "userId": {
      "_id": "user_id",
      "name": "Test Tenant",
      "email": "tenant@test.com"
    },
    "balance": 120000,
    "currency": "NGN",
    "totalEarnings": 150000,
    "totalSpent": 30000,
    "isActive": true,
    "currencySymbol": "₦"
  }
}
```

### 6.2 Unified Wallet Transaction

**`POST /api/wallet/transaction`**

**Access:** All roles

**Request Body:**

#### Deposit
```json
{
  "type": "deposit",
  "amount": 50000,
  "description": "Funding wallet"
}
```

#### Withdraw
```json
{
  "type": "withdraw",
  "amount": 20000,
  "description": "Monthly withdrawal",
  "bankDetails": {
    "accountName": "John Doe",
    "accountNumber": "1234567890",
    "bankName": "GTBank"
  }
}
```

#### Transfer to User
```json
{
  "type": "transfer",
  "amount": 10000,
  "description": "Payment for services",
  "recipientEmail": "user@example.com",
  "recipientType": "user"
}
```

#### Transfer to Estate
```json
{
  "type": "transfer",
  "amount": 15000,
  "description": "Rent payment",
  "recipientId": "estate_mongodb_id",
  "recipientType": "estate"
}
```

**Request Fields:**

| Field | Required | Type | Description |
|---|---|---|---|
| `type` | yes | string | `deposit`, `withdraw`, `transfer` |
| `amount` | yes | number | Amount > 0 |
| `description` | no | string | Max 500 chars |
| `recipientEmail` | transfer only | string | Recipient email |
| `recipientId` | transfer only | string | MongoDB ID |
| `recipientType` | transfer only | string | `user` or `estate` |
| `bankDetails` | withdraw only | object | Bank details |

**Response (200) - Deposit:**
```json
{
  "success": true,
  "message": "Deposit successful",
  "data": {
    "transaction": "txn_id",
    "amount": 50000,
    "newBalance": 50000,
    "type": "deposit"
  }
}
```

**Response (200) - Withdraw:**
```json
{
  "success": true,
  "message": "Withdrawal request submitted successfully",
  "data": {
    "withdrawal": "wd_id",
    "amount": 20000,
    "newBalance": 30000,
    "status": "pending",
    "type": "withdraw"
  }
}
```

**Response (200) - Transfer:**
```json
{
  "success": true,
  "message": "Transfer successful",
  "data": {
    "transaction": "txn_id",
    "amount": 10000,
    "newBalance": 40000,
    "recipient": "User Name",
    "recipientType": "user",
    "type": "transfer"
  }
}
```

### 6.3 Get Own Transaction History

**`GET /api/wallet/transactions`**

**Access:** All roles

**Description:** Returns all transactions for the authenticated user.

**Response (200):**
```json
{
  "success": true,
  "count": 4,
  "data": [
    {
      "_id": "txn_id",
      "user": "user_id",
      "walletId": "wallet_id",
      "amount": 50000,
      "type": "deposit",
      "method": "other",
      "status": "completed",
      "reference": "DEP-1714392000000",
      "description": "Wallet deposit",
      "createdAt": "2024-06-01T00:00:00.000Z"
    }
  ]
}
```

### 6.4 Get All Transactions (Role-Based)

**`GET /api/wallet/transactions/list`**

**Access:** All roles

**Query Parameters:**

| Param | Default | Description |
|---|---|---|
| `page` | 1 | Page number |
| `limit` | 20 | Items per page |
| `type` | - | Filter: `deposit`, `withdrawal`, `transfer`, `rent`, etc. |
| `status` | - | Filter: `completed`, `pending`, `failed`, `paid` |
| `search` | - | Search description or reference |
| `startDate` | - | Filter from date (ISO string) |
| `endDate` | - | Filter to date (ISO string) |

**Response (200):**
```json
{
  "success": true,
  "count": 2,
  "total": 15,
  "page": 1,
  "pages": 2,
  "data": [
    {
      "_id": "txn_id",
      "user": {
        "_id": "user_id",
        "name": "Test Tenant",
        "email": "tenant@test.com",
        "role": "tenant"
      },
      "walletId": { "balance": 120000 },
      "estate": { "name": "Test Estate" },
      "amount": 50000,
      "type": "deposit",
      "method": "other",
      "status": "completed",
      "reference": "DEP-1714392000000",
      "description": "Wallet deposit",
      "createdAt": "2024-06-01T00:00:00.000Z"
    }
  ]
}
```

**Role-Based Access:**

| Role | Scope |
|---|---|
| `super_admin` | All transactions |
| `admin`, `super_manager`, `business_owner` | Assigned estates + own |
| `tenant`, `vendor`, `manager`, `user` | Own transactions only |

### 6.5 Add Funds to Wallet

**`POST /api/wallet/add-funds`**

**Access:** All roles

**Request Body:**
```json
{
  "amount": 10000
}
```

### 6.6 Initialize Paystack Deposit

**`POST /api/wallet/paystack/initialize`**

**Access:** All roles

**Request Body:**
```json
{
  "email": "tenant@test.com",
  "amount": 50000,
  "reference": "WALLET-REF-123"
}
```

**Response (200):**
```json
{
  "success": true,
  "data": {
    "authorizationUrl": "https://checkout.paystack.com/...",
    "accessCode": "access_code",
    "reference": "WALLET-REF-123"
  }
}
```

### 6.7 Verify Paystack Deposit

**`GET /api/wallet/paystack/verify/:reference`**

**Access:** All roles

**Response (200):**
```json
{
  "success": true,
  "data": {
    "payment": {
      "status": "success",
      "amount": 50000
    }
  }
}
```

---

## 7. Dashboard

### 7.1 Get Dashboard Overview

**`GET /api/dashboard/overview`**

**Access:** All roles (role-specific response)

**Description:** Returns a role-based dashboard overview. For tenants, returns apartment info, billing, payments, wallet balance, and notifications.

**Response (200) - Tenant:**
```json
{
  "success": true,
  "message": "tenant overview retrieved successfully",
  "data": {
    "role": "tenant",
    "user": {
      "id": "user_id",
      "name": "John",
      "email": "john@example.com"
    },
    "data": {
      "section": "TENANT_OVERVIEW",
      "apartment": {
        "id": "tenant_id",
        "tenantName": "John Doe",
        "unit": "A1",
        "estate": "Sunset Estate",
        "rentAmount": 500000,
        "nextDueDate": "2025-01-15T00:00:00.000Z"
      },
      "billing": {
        "totalPending": 550000,
        "totalPaid": 3000000,
        "upcomingDue": [
          {
            "code": "rent",
            "label": "Rent",
            "amount": 500000,
            "dueDate": "2025-01-15"
          }
        ],
        "overdue": []
      },
      "payments": {
        "recentPayments": [
          {
            "amount": 500000,
            "paymentType": "rent",
            "paymentStatus": "completed",
            "createdAt": "2024-06-01T00:00:00.000Z"
          }
        ],
        "totalPaid": 3000000
      },
      "wallet": {
        "balance": 120000,
        "currency": "NGN"
      },
      "notifications": []
    }
  }
}
```

---

## 8. Service Requests

### 8.1 Create Service Request

**`POST /api/service-requests`**

**Access:** All roles

**Description:** Tenants can request services. Estate and unit are auto-detected from tenant record.

**Request Body:**
```json
{
  "vendor": "vendor_id",
  "businessType": "plumbing",
  "description": "Fix leaking pipe in kitchen",
  "scheduledDate": "2024-06-20"
}
```

**Response (201):**
```json
{
  "success": true,
  "data": {
    "_id": "request_id",
    "businessType": "plumbing",
    "description": "Fix leaking pipe in kitchen",
    "status": "pending",
    "scheduledDate": "2024-06-20T00:00:00.000Z"
  }
}
```

### 8.2 Get My Service Requests

**`GET /api/service-requests/my-requests`**

**Access:** All roles

**Query Parameters:** `page`, `limit`, `status`

**Response (200):**
```json
{
  "success": true,
  "count": 2,
  "data": [
    {
      "_id": "request_id",
      "businessType": "plumbing",
      "description": "Fix leaking pipe",
      "status": "completed",
      "createdAt": "2024-06-01T00:00:00.000Z"
    }
  ]
}
```

### 8.3 Update Service Request Status

**`PUT /api/service-requests/:id/status`**

**Access:** Protected (Requester can cancel only)

**Request Body:**
```json
{
  "status": "cancelled"
}
```

---

## 9. Estate Management

### 9.1 List Estates

**`GET /api/estates`**

**Access:** Protected

**Query Parameters:** `page`, `limit`, `search`

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "_id": "estate_id",
      "name": "Sunset Estate",
      "description": "A beautiful estate",
      "totalUnits": 50,
      "occupiedUnits": 35
    }
  ]
}
```

### 9.2 Get Estate by ID

**`GET /api/estates/:id`**

**Access:** Protected

**Response (200):**
```json
{
  "success": true,
  "data": {
    "_id": "estate_id",
    "name": "Sunset Estate",
    "description": "A beautiful estate",
    "totalUnits": 50,
    "managers": ["manager_id"],
    "units": [...]
  }
}
```

---

## 10. Unit Management

### 10.1 List Units

**`GET /api/estates/:estateId/units`**

**Access:** Protected

**Query Parameters:** `page`, `limit`, `status`

**Response (200):**
```json
{
  "success": true,
  "data": [
    {
      "_id": "unit_id",
      "label": "A1",
      "category": "Apartment",
      "monthlyPrice": 500000,
      "serviceChargeMonthly": 50000,
      "status": "occupied",
      "occupiedBy": "tenant_id"
    }
  ]
}
```

### 10.2 Assign Tenant to Unit

**`POST /api/estates/:estateId/units/:unitId/assign-tenant`**

**Access:** Protected

**Request Body:**
```json
{
  "tenantId": "tenant_id"
}
```

### 10.3 Remove Tenant from Unit

**`POST /api/estates/:estateId/units/:unitId/remove-tenant`**

**Access:** Protected

**Response (200):**
```json
{
  "success": true,
  "message": "Tenant removed from unit"
}
```

---

## Error Codes

| Status | Description |
|---|---|
| 400 | Validation error, bad request |
| 401 | Not authenticated (missing/invalid token) |
| 403 | Not authorized (insufficient permissions) |
| 404 | Resource not found |
| 500 | Server error |

## Common Error Response

```json
{
  "success": false,
  "message": "Error description",
  "errors": [
    {
      "msg": "Field is required",
      "path": "fieldName",
      "location": "body"
    }
  ]
}
```
