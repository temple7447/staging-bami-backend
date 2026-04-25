# 🎯 Dashboard Overview - Quick Start Guide

## The Solution

**One endpoint that returns different data based on user role:**

```bash
GET /api/dashboard/overview
```

---

## 📲 Quick Test (2 minutes)

### Step 1: Get Token
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "tenant@example.com",
    "password": "password"
  }' | jq -r '.data.token'
```

### Step 2: Copy the token and test dashboard
```bash
# Replace YOUR_TOKEN_HERE with actual token
curl -X GET http://localhost:5000/api/dashboard/overview \
  -H "Authorization: Bearer YOUR_TOKEN_HERE"
```

### Step 3: Get response based on role! 🎉

---

## 📊 What Each Role Sees

### 👥 TENANT
```json
{
  "apartment": {
    "unit": "Flat 4B",
    "estate": "Rose Garden Estate",
    "rentAmount": 150000,
    "nextDueDate": "2026-05-25"
  },
  "billing": {
    "totalPending": 160000,
    "totalPaid": 450000,
    "overdue": [ ... ],
    "upcomingDue": [ ... ]
  },
  "payments": { ... },
  "wallet": { ... },
  "notifications": [ ... ]
}
```

### 🏢 BUSINESS OWNER
```json
{
  "estates": [ ... ],
  "statistics": {
    "totalEstates": 2,
    "occupiedUnits": 40,
    "occupancyRate": 89,
    "totalRevenueGenerated": 5400000,
    "pendingPayments": 640000
  }
}
```

### 🔧 VENDOR
```json
{
  "businessInfo": { ... },
  "statistics": {
    "totalRequests": 25,
    "completedRequests": 18,
    "totalEarnings": 500000
  },
  "recentRequests": [ ... ],
  "wallet": { ... }
}
```

### 👨‍💼 MANAGER
```json
{
  "statistics": {
    "assignedEstates": 3,
    "assignedStaff": 12,
    "tasksDue": 5
  }
}
```

### 🛡️ SUPER_ADMIN
```json
{
  "statistics": {
    "totalUsers": 1250,
    "totalEstates": 85,
    "systemRevenue": 125000000,
    "activeTransactions": 156
  },
  "userDistribution": { ... }
}
```

---

## 💻 Frontend (React)

```jsx
import { useEffect, useState } from 'react';

export const Dashboard = () => {
  const [data, setData] = useState(null);

  useEffect(() => {
    const fetch = async () => {
      const token = localStorage.getItem('token');
      const res = await fetch(
        'http://localhost:5000/api/dashboard/overview',
        { headers: { 'Authorization': `Bearer ${token}` } }
      );
      const result = await res.json();
      setData(result.data);
    };
    fetch();
  }, []);

  if (!data) return <div>Loading...</div>;

  // Tenant View
  if (data.role === 'tenant') {
    return (
      <div>
        <h1>Apartment: {data.data.apartment.unit}</h1>
        <h2>Rent: ₦{data.data.apartment.rentAmount}</h2>
        
        <h3>Bills</h3>
        <p>Total Pending: ₦{data.data.billing.totalPending}</p>
        <p>Total Paid: ₦{data.data.billing.totalPaid}</p>
        
        {data.data.billing.overdue.length > 0 && (
          <div className="alert">
            <h4>⚠️ Overdue Items</h4>
            {data.data.billing.overdue.map(item => (
              <div key={item.id}>
                {item.label} - ₦{item.amount} ({item.daysOverdue} days overdue)
              </div>
            ))}
          </div>
        )}
      </div>
    );
  }

  // Business Owner View
  if (data.role === 'business_owner') {
    return (
      <div>
        <h1>Properties Overview</h1>
        <p>Estates: {data.data.statistics.totalEstates}</p>
        <p>Occupancy: {data.data.statistics.occupancyRate}%</p>
        <p>Revenue: ₦{data.data.statistics.totalRevenueGenerated}</p>
      </div>
    );
  }

  return <div>Role: {data.role}</div>;
};
```

---

## 📁 Files Created

| File | Purpose |
|------|---------|
| `controllers/dashboardController.js` | Main business logic |
| `routes/dashboard.js` | Route definition |
| `server.js` | Updated with route |
| `docs/UNIFIED_DASHBOARD_ENDPOINT.md` | Full API docs |
| `docs/DASHBOARD_QUICK_REFERENCE.md` | Visual overview |
| `docs/FRONTEND_INTEGRATION_EXAMPLE.js` | React examples |
| `docs/UNIFIED_DASHBOARD_COMPLETE.md` | Complete summary |

---

## ✅ Verified

- ✅ No syntax errors
- ✅ All files in place
- ✅ Ready to test
- ✅ Full documentation included

---

## 🚀 Next: Try It!

1. Start your server: `npm start`
2. Get a token from `/api/auth/login`
3. Call `/api/dashboard/overview` with the token
4. You'll get role-specific data!

---

## 📖 Full Docs

- **API Documentation**: `/docs/UNIFIED_DASHBOARD_ENDPOINT.md`
- **Quick Reference**: `/docs/DASHBOARD_QUICK_REFERENCE.md`
- **React Examples**: `/docs/FRONTEND_INTEGRATION_EXAMPLE.js`
- **Complete Summary**: `/docs/UNIFIED_DASHBOARD_COMPLETE.md`

**Everything you need is documented!** 📚
