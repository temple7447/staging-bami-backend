# Dashboard Overview Endpoint

## Overview
A unified single endpoint that returns role-specific dashboard overview data. This endpoint automatically adapts the response based on the authenticated user's role.

## Endpoint
```
GET /api/dashboard/overview
```

## Authentication
**Required**: Bearer token (JWT)

## Response Structure

### Common Response Format
```json
{
  "success": true,
  "message": "{role} overview retrieved successfully",
  "data": {
    "role": "tenant|business_owner|vendor|manager|super_admin",
    "user": {
      "id": "user_id",
      "name": "User Name",
      "email": "user@example.com",
      "role": "tenant",
      "profileImageUrl": "url_or_null"
    },
    "timestamp": "2026-04-25T10:30:00.000Z",
    "data": {
      // Role-specific data (see below)
    }
  }
}
```

---

## Role-Specific Responses

### 1. TENANT Overview

**Use Case**: Tenant users viewing their dashboard

**Response Data Structure**:
```json
{
  "section": "TENANT_OVERVIEW",
  "apartment": {
    "id": "tenant_id",
    "tenantName": "John Doe",
    "unit": "Flat 4B",
    "unitType": "2-bedroom",
    "estate": "Rose Garden Estate",
    "rentAmount": 150000,
    "serviceChargeAmount": 10000,
    "entryDate": "2025-01-15T00:00:00.000Z",
    "nextDueDate": "2025-05-25T00:00:00.000Z",
    "status": "occupied",
    "leaseEndsOn": "2026-01-15T00:00:00.000Z"
  },
  "billing": {
    "totalPending": 160000,
    "totalPaid": 450000,
    "upcomingDue": [
      {
        "id": "billing_item_id",
        "label": "May Rent",
        "itemType": "rent",
        "amount": 150000,
        "dueDate": "2026-05-25T00:00:00.000Z",
        "description": "Monthly rent payment"
      }
    ],
    "overdue": [
      {
        "id": "billing_item_id_2",
        "label": "Service Charge",
        "itemType": "service_charge",
        "amount": 10000,
        "dueDate": "2026-04-25T00:00:00.000Z",
        "description": "Monthly service charge",
        "daysOverdue": 5
      }
    ]
  },
  "payments": {
    "recentPayments": [
      {
        "id": "payment_id",
        "amount": 150000,
        "paymentType": "rent",
        "description": "April Rent Payment",
        "date": "2026-04-20T14:30:00.000Z",
        "reference": "PSK_ref_12345"
      }
    ],
    "totalPaid": 450000
  },
  "wallet": {
    "balance": 25000,
    "totalEarnings": 0,
    "totalSpent": 0,
    "currency": "NGN"
  },
  "notifications": [
    {
      "id": "notification_id",
      "title": "Rent Due Soon",
      "message": "Your rent is due on May 25, 2026",
      "type": "reminder",
      "createdAt": "2026-04-24T09:00:00.000Z"
    }
  ]
}
```

**Key Fields**:
- `apartment`: Current housing information
- `billing.totalPending`: Total unpaid bills in NGN
- `billing.upcomingDue`: Bills due in the future
- `billing.overdue`: Overdue bills with days overdue
- `payments.recentPayments`: Last 5 payments made
- `wallet.balance`: Available wallet funds
- `notifications`: Unread notifications (max 5)

---

### 2. BUSINESS_OWNER / ADMIN Overview

**Use Case**: Property owners/managers viewing property performance

**Response Data Structure**:
```json
{
  "section": "BUSINESS_OWNER_OVERVIEW",
  "estates": [
    {
      "id": "estate_id",
      "name": "Rose Garden Estate",
      "address": "123 Main Street, Lagos",
      "totalUnits": 20,
      "occupiedUnits": 18,
      "vacantUnits": 2,
      "totalTenants": 18,
      "revenue": 2700000,
      "pendingPayments": 320000
    }
  ],
  "statistics": {
    "totalEstates": 2,
    "totalUnits": 45,
    "occupiedUnits": 40,
    "vacantUnits": 5,
    "totalTenants": 40,
    "totalRevenueGenerated": 5400000,
    "pendingPayments": 640000,
    "unpaidBills": 8,
    "occupancyRate": 89
  },
  "recentPayments": [
    {
      "id": "payment_id",
      "tenantName": "John Doe",
      "amount": 150000,
      "paymentType": "rent",
      "date": "2026-04-20T14:30:00.000Z"
    }
  ],
  "topStats": {}
}
```

**Key Fields**:
- `estates`: List of all managed estates with occupancy info
- `statistics.occupancyRate`: Percentage of occupied units (0-100)
- `statistics.totalRevenueGenerated`: Total income from all properties
- `statistics.pendingPayments`: Total outstanding payments
- `recentPayments`: Latest 10 payments across all estates

---

### 3. VENDOR / SUPER_VENDOR Overview

**Use Case**: Service providers viewing assigned work

**Response Data Structure**:
```json
{
  "section": "VENDOR_OVERVIEW",
  "businessInfo": {
    "businessName": "Quick Repairs Ltd",
    "specialization": "Electrical & Plumbing",
    "businessType": "business_type_id"
  },
  "statistics": {
    "totalRequests": 25,
    "completedRequests": 18,
    "pendingRequests": 4,
    "inProgressRequests": 3,
    "totalEarnings": 500000,
    "rating": 4.8
  },
  "recentRequests": [
    {
      "id": "service_request_id",
      "title": "Fix broken tap",
      "description": "Water tap in Flat 4B is leaking",
      "status": "in_progress",
      "priority": "high",
      "estimatedBudget": 5000,
      "createdAt": "2026-04-24T10:00:00.000Z"
    }
  ],
  "wallet": {
    "balance": 150000,
    "totalEarnings": 500000,
    "currency": "NGN"
  }
}
```

**Key Fields**:
- `businessInfo`: Vendor business details
- `statistics`: Work metrics (total, completed, pending, in progress)
- `statistics.totalEarnings`: Cumulative earnings
- `recentRequests`: Last 10 service requests
- `wallet`: Current balance and earnings

---

### 4. MANAGER / SUPER_MANAGER Overview

**Use Case**: Property managers tracking operations

```json
{
  "section": "MANAGER_OVERVIEW",
  "statistics": {
    "assignedEstates": 3,
    "assignedStaff": 12,
    "tasksDue": 5,
    "upcomingInspections": 2
  },
  "responsibilities": [],
  "tasks": [],
  "alerts": []
}
```

**Note**: This can be extended based on your manager responsibilities model

---

### 5. SUPER_ADMIN Overview

**Use Case**: System administrators viewing platform health

**Response Data Structure**:
```json
{
  "section": "SYSTEM_OVERVIEW",
  "statistics": {
    "totalUsers": 1250,
    "totalEstates": 85,
    "totalTenants": 1200,
    "totalUnits": 3500,
    "systemRevenue": 125000000,
    "activeTransactions": 156
  },
  "userDistribution": {
    "tenant": 1000,
    "business_owner": 80,
    "vendor": 120,
    "admin": 30,
    "super_admin": 20
  },
  "recentActivities": [],
  "systemHealth": {
    "status": "healthy",
    "checks": []
  }
}
```

**Key Fields**:
- `statistics`: Platform-wide metrics
- `userDistribution`: User count by role
- `systemRevenue`: Total revenue across platform
- `activeTransactions`: Unpaid bills in system

---

## Error Responses

### 401 Unauthorized
```json
{
  "success": false,
  "message": "Not authorized to access this route"
}
```

### 500 Server Error
```json
{
  "success": false,
  "message": "Error fetching overview",
  "error": "error message details"
}
```

---

## Usage Examples

### cURL
```bash
curl -X GET http://localhost:5000/api/dashboard/overview \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json"
```

### JavaScript (Fetch)
```javascript
const fetchOverview = async () => {
  const token = localStorage.getItem('token');
  
  const response = await fetch('http://localhost:5000/api/dashboard/overview', {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    }
  });

  const data = await response.json();
  console.log(data);
  return data;
};
```

### Axios
```javascript
import axios from 'axios';

const getOverview = async () => {
  try {
    const token = localStorage.getItem('token');
    
    const response = await axios.get(
      'http://localhost:5000/api/dashboard/overview',
      {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      }
    );

    console.log(response.data);
    return response.data;
  } catch (error) {
    console.error('Error fetching overview:', error.response?.data || error.message);
  }
};
```

---

## Benefits

✅ **Single Endpoint**: No need to call multiple endpoints per role
✅ **Role-Adaptive**: Automatically returns relevant data
✅ **Efficient**: Optimized queries per role
✅ **Extensible**: Easy to add new roles
✅ **Consistent**: Same response format for all roles
✅ **Secure**: Requires authentication

---

## Future Enhancements

- [ ] Add filtering options (date range, specific estate)
- [ ] Pagination for large result sets
- [ ] Caching for frequently accessed data
- [ ] Real-time updates via WebSocket
- [ ] Custom dashboard widgets selection
- [ ] Export overview as PDF/Excel
