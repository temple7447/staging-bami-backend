# Wallet & Transaction API Documentation

Base URL: `/api/wallet`

All endpoints require authentication via Bearer token in the `Authorization` header.

---

## 1. Get Wallet Balance

**`GET /api/wallet`**

**Access:** All roles

**Description:** Returns the authenticated user's wallet balance and information. Wallet is auto-created if it doesn't exist.

### Response (200)
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
    "transactions": ["txn_id_1", "txn_id_2"],
    "lastUpdated": "2026-04-29T11:00:00.000Z",
    "isActive": true,
    "currencySymbol": "₦"
  }
}
```

---

## 2. Unified Wallet Transaction

**`POST /api/wallet/transaction`**

**Access:** All roles

**Description:** Single endpoint for deposit, withdrawal, and transfer operations.

### Request Body

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

### Request Fields

| Field | Required | Type | Description |
|---|---|---|---|
| `type` | yes | string | `"deposit"`, `"withdraw"`, or `"transfer"` |
| `amount` | yes | number | Amount > 0 |
| `description` | no | string | Max 500 chars |
| `recipientEmail` | transfer only | string | Recipient's email |
| `recipientId` | transfer only | string | MongoDB ObjectId of recipient or estate |
| `recipientType` | transfer only | string | `"user"` or `"estate"` |
| `bankDetails` | withdraw only | object | Bank account details |
| `bankDetails.accountName` | withdraw only | string | Account holder name |
| `bankDetails.accountNumber` | withdraw only | string | Account number |
| `bankDetails.bankName` | withdraw only | string | Bank name |

### Response (200) - Deposit
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

### Response (200) - Withdraw
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

### Response (200) - Transfer
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

### Error Responses (400)
```json
{
  "success": false,
  "message": "Insufficient balance"
}
```
```json
{
  "success": false,
  "message": "Validation errors",
  "errors": [
    { "msg": "Amount must be greater than 0", "path": "amount" }
  ]
}
```

---

## 3. Get Own Transaction History

**`GET /api/wallet/transactions`**

**Access:** All roles

**Description:** Returns all transactions for the authenticated user only.

### Query Parameters
None (returns all)

### Response (200)
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
      "isActive": true,
      "createdBy": "user_id",
      "createdAt": "2026-04-29T11:00:00.000Z",
      "updatedAt": "2026-04-29T11:00:00.000Z"
    }
  ]
}
```

---

## 4. Get All Transactions (Role-Based)

**`GET /api/wallet/transactions/list`**

**Access:** All roles

**Description:** Returns transactions with role-based filtering. Super admins see all, admins see estate-related + own, others see only their own.

### Query Parameters

| Param | Default | Description |
|---|---|---|
| `page` | 1 | Page number |
| `limit` | 20 | Items per page |
| `type` | - | Filter by type: `deposit`, `withdrawal`, `transfer`, `rent`, etc. |
| `status` | - | Filter by status: `completed`, `pending`, `failed`, `paid` |
| `search` | - | Search in description or reference |
| `startDate` | - | Filter from date (ISO string) |
| `endDate` | - | Filter to date (ISO string) |

### Example Request
```
GET /api/wallet/transactions/list?page=1&limit=10&type=deposit&status=completed
```

### Response (200)
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
      "walletId": {
        "balance": 120000
      },
      "estate": {
        "name": "Test Estate"
      },
      "tenant": {
        "tenantName": "Test Tenant"
      },
      "amount": 50000,
      "type": "deposit",
      "method": "other",
      "status": "completed",
      "reference": "DEP-1714392000000",
      "description": "Wallet deposit",
      "isActive": true,
      "createdBy": "user_id",
      "createdAt": "2026-04-29T11:00:00.000Z",
      "updatedAt": "2026-04-29T11:00:00.000Z"
    }
  ]
}
```

### Role-Based Access

| Role | Scope |
|---|---|
| `super_admin` | All transactions across all users |
| `admin`, `super_manager`, `business_owner` | Transactions for their assigned estates + own |
| `tenant`, `vendor`, `manager`, `user` | Only their own transactions |

---

## Error Codes

| Status | Description |
|---|---|
| 400 | Validation error, insufficient balance, invalid data |
| 401 | Not authenticated (missing/invalid token) |
| 404 | Wallet/recipient/estate not found |
| 500 | Server error |
