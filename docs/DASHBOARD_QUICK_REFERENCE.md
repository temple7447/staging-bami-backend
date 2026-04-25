# Unified Dashboard - Quick Reference

## ✅ What You Now Have

### 1 Endpoint - Multiple Roles
```
GET /api/dashboard/overview
```
**Returns different data based on authenticated user's role**

---

## 🏠 TENANT Overview (Focus)

### What It Shows
```
┌─────────────────────────────────────┐
│         APARTMENT INFO              │
│ ├─ Unit: Flat 4B                   │
│ ├─ Estate: Rose Garden Estate       │
│ ├─ Rent: ₦150,000/month             │
│ ├─ Service Charge: ₦10,000/month    │
│ ├─ Next Due: May 25, 2026           │
│ └─ Status: Occupied                 │
├─────────────────────────────────────┤
│       FINANCIAL SUMMARY             │
│ ├─ Total Pending: ₦160,000          │
│ ├─ Total Paid: ₦450,000             │
│ ├─ Wallet Balance: ₦25,000          │
│ └─ Outstanding Items: 2             │
├─────────────────────────────────────┤
│      UPCOMING & OVERDUE             │
│ ├─ Overdue (5 days): Service Charge │
│ │   Amount: ₦10,000                 │
│ ├─ Due Soon: May Rent               │
│ │   Amount: ₦150,000                │
│ │   Days to: 1 day                  │
├─────────────────────────────────────┤
│      RECENT PAYMENTS                │
│ ├─ April Rent: ₦150,000 (Apr 20)    │
│ ├─ March Rent: ₦150,000 (Mar 20)    │
│ └─ Feb Rent: ₦150,000 (Feb 20)      │
├─────────────────────────────────────┤
│      NOTIFICATIONS                  │
│ └─ Unread: 3 notifications          │
└─────────────────────────────────────┘
```

---

## 📊 BUSINESS OWNER Overview

```
┌─────────────────────────────────────┐
│      PORTFOLIO SUMMARY              │
│ ├─ Total Estates: 2                 │
│ ├─ Total Units: 45                  │
│ ├─ Occupied: 40 (89%)               │
│ ├─ Vacant: 5 (11%)                  │
├─────────────────────────────────────┤
│      FINANCIAL METRICS              │
│ ├─ Total Revenue: ₦5,400,000        │
│ ├─ Pending Payments: ₦640,000       │
│ └─ Unpaid Bills: 8                  │
├─────────────────────────────────────┤
│    ESTATES (Detailed View)          │
│ ├─ Rose Garden Estate               │
│ │  ├─ Units: 20 (18 occupied)       │
│ │  ├─ Revenue: ₦2,700,000           │
│ │  └─ Pending: ₦320,000             │
│ └─ Pine Valley Estate               │
│    ├─ Units: 25 (22 occupied)       │
│    ├─ Revenue: ₦2,700,000           │
│    └─ Pending: ₦320,000             │
└─────────────────────────────────────┘
```

---

## 🔧 VENDOR Overview

```
┌─────────────────────────────────────┐
│      BUSINESS PROFILE               │
│ ├─ Business: Quick Repairs Ltd      │
│ ├─ Specialization: Electrical       │
│ └─ Rating: 4.8/5                    │
├─────────────────────────────────────┤
│      WORK METRICS                   │
│ ├─ Total Requests: 25               │
│ ├─ Completed: 18                    │
│ ├─ In Progress: 3                   │
│ ├─ Pending: 4                       │
├─────────────────────────────────────┤
│      EARNINGS                       │
│ ├─ Total Earnings: ₦500,000         │
│ ├─ Wallet Balance: ₦150,000         │
│ └─ Pending Payouts: ₦350,000        │
├─────────────────────────────────────┤
│    RECENT REQUESTS (Last 10)        │
│ ├─ Fix broken tap (In Progress)     │
│ ├─ Paint apartment (Pending)        │
│ └─ Fix door lock (Completed)        │
└─────────────────────────────────────┘
```

---

## 👨‍💼 MANAGER Overview

```
┌─────────────────────────────────────┐
│      MANAGEMENT SUMMARY             │
│ ├─ Assigned Estates: 3              │
│ ├─ Assigned Staff: 12               │
│ ├─ Tasks Due: 5                     │
│ └─ Upcoming Inspections: 2          │
└─────────────────────────────────────┘
```
*(Extensible based on your needs)*

---

## 🛡️ SUPER ADMIN Overview

```
┌─────────────────────────────────────┐
│      SYSTEM METRICS                 │
│ ├─ Total Users: 1,250               │
│ ├─ Total Estates: 85                │
│ ├─ Total Tenants: 1,200             │
│ ├─ Total Units: 3,500               │
├─────────────────────────────────────┤
│      PLATFORM PERFORMANCE           │
│ ├─ System Revenue: ₦125M            │
│ ├─ Active Transactions: 156         │
│ └─ System Status: Healthy           │
├─────────────────────────────────────┤
│      USER DISTRIBUTION              │
│ ├─ Tenants: 1,000                   │
│ ├─ Vendors: 120                     │
│ ├─ Owners: 80                       │
│ ├─ Admins: 30                       │
│ └─ Super Admins: 20                 │
└─────────────────────────────────────┘
```

---

## 🧪 Testing the Endpoint

### 1. Get Your Token
```bash
# Login first
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"tenant@example.com","password":"password123"}'
```

### 2. Call Dashboard Endpoint
```bash
curl -X GET http://localhost:5000/api/dashboard/overview \
  -H "Authorization: Bearer YOUR_TOKEN_HERE" \
  -H "Content-Type: application/json"
```

### 3. Check Response
You'll get back the appropriate data structure for that user's role!

---

## 📁 Files Created

```
✅ controllers/dashboardController.js    - Main logic
✅ routes/dashboard.js                    - Route definition  
✅ docs/UNIFIED_DASHBOARD_ENDPOINT.md    - Full documentation
✅ server.js                              - Route registration (updated)
```

---

## 🚀 Key Features

| Feature | Benefit |
|---------|---------|
| **Single Endpoint** | No need to call different URLs per role |
| **Role-Adaptive** | Automatically returns relevant data |
| **Optimized Queries** | Each role only gets what it needs |
| **Secure** | Requires JWT authentication |
| **Extensible** | Easy to add new roles or data fields |
| **Consistent Format** | Same response structure for all roles |

---

## 🔄 How the Tenant Overview Works

```
User (Tenant) Request
        ↓
/api/dashboard/overview
        ↓
Authentication Check (Bearer Token)
        ↓
Get User Role (tenant)
        ↓
getTenantOverview() Function
        ├─ Get Tenant Record (unit, estate, lease dates)
        ├─ Get Billing Items (unpaid, paid, overdue)
        ├─ Get Recent Payments (last 5)
        ├─ Get Wallet Info (balance, earnings)
        └─ Get Notifications (unread, limit 5)
        ↓
Return JSON with all aggregated data
        ↓
Frontend receives complete overview in ONE call!
```

---

## 📈 Next Steps (Optional)

- Add date range filtering
- Implement caching for faster responses
- Add export to PDF/Excel
- Real-time updates via WebSocket
- More granular statistics
- Custom dashboard layouts

---

## ❓ Questions?

Check the full documentation in:
📄 `/docs/UNIFIED_DASHBOARD_ENDPOINT.md`

Or review the code:
💾 `/controllers/dashboardController.js`
💾 `/routes/dashboard.js`
