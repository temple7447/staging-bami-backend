# VENDOR MANAGER ASSIGNMENT - ADMIN USAGE GUIDE

## Overview

When the admin wants to **add a new vendor**, they **MUST pick a manager** to manage that vendor. This guide shows you how to do it step-by-step using the API.

---

## Step 1: Get the List of Available Managers

**Before you can add a vendor**, you need to see which managers are available to manage the vendor.

### API Call

```http
GET /api/auth/managers
Authorization: Bearer <your_admin_token>
```

### Example using curl

```bash
curl -X GET "http://localhost:5000/api/auth/managers?page=1&limit=20" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

### Response

```json
{
  "success": true,
  "count": 5,
  "total": 5,
  "pagination": {
    "currentPage": 1,
    "totalPages": 1,
    "limit": 20
  },
  "data": [
    {
      "_id": "607f1f77bcf86cd799439011",
      "name": "Ahmed Hassan",
      "email": "ahmed@bamihustle.com",
      "phone": "+234812345678",
      "role": "manager",
      "isActive": true,
      "createdAt": "2026-02-01T10:00:00.000Z"
    },
    {
      "_id": "607f1f77bcf86cd799439012",
      "name": "Chioma Okoro",
      "email": "chioma@bamihustle.com",
      "phone": "+234812345679",
      "role": "manager",
      "isActive": true,
      "createdAt": "2026-02-05T14:30:00.000Z"
    }
    // ... more managers
  ]
}
```

### What to do with this information

1. Display the list of managers to the admin
2. Admin selects the manager they want to assign to the new vendor
3. Copy the manager's `_id` (e.g., "607f1f77bcf86cd799439011")

---

## Step 2: Create/Onboard the Vendor

**Now that you have the manager ID**, use it to create the vendor.

### API Call

```http
POST /api/auth/onboard-vendor
Authorization: Bearer <your_admin_token>
Content-Type: application/json

{
  "name": "John Smith",
  "email": "john.smith@vendorcompany.com",
  "phone": "+2348123456789",
  "position": "Senior Electrician",
  "managerId": "607f1f77bcf86cd799439011",
  "sendCredentials": true
}
```

### Example using curl

```bash
curl -X POST "http://localhost:5000/api/auth/onboard-vendor" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "John Smith",
    "email": "john.smith@vendorcompany.com",
    "phone": "+2348123456789",
    "position": "Senior Electrician",
    "managerId": "607f1f77bcf86cd799439011",
    "sendCredentials": true
  }'
```

### Request Parameters

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| name | string | Yes | Vendor's full name |
| email | string | Yes | Vendor's unique email (must not exist) |
| phone | string | No | Vendor's phone number |
| position | string | No | Vendor's position/title (e.g., "Electrician") |
| managerId | string | Yes | **REQUIRED** - ID of the manager to assign |
| sendCredentials | boolean | No | Send welcome email to vendor (default: true) |

### Success Response (201 Created)

```json
{
  "success": true,
  "message": "Vendor onboarded successfully. Credentials sent to john.smith@vendorcompany.com",
  "data": {
    "id": "69ad65fbcd1b0d2b544b489e",
    "name": "John Smith",
    "email": "john.smith@vendorcompany.com",
    "phone": "+2348123456789",
    "position": "Senior Electrician",
    "role": "vendor",
    "manager": {
      "_id": "607f1f77bcf86cd799439011",
      "name": "Ahmed Hassan",
      "email": "ahmed@bamihustle.com"
    },
    "isActive": true,
    "createdAt": "2026-03-08T12:00:00.000Z"
  }
}
```

### What Happens Next

✅ Vendor account is created
✅ Manager is assigned and linked
✅ Welcome email sent to vendor with temporary login credentials
✅ System records the admin who created the vendor
✅ Vendor is now active and can log in

---

## Step 3: Check if Vendor was Created with Manager

**To verify the vendor was created and manager is assigned:**

### API Call

```http
GET /api/auth/vendors?limit=10&page=1
Authorization: Bearer <your_admin_token>
```

### Example using curl

```bash
curl -X GET "http://localhost:5000/api/auth/vendors?limit=10&page=1" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json"
```

### Response

```json
{
  "success": true,
  "count": 2,
  "total": 50,
  "pagination": {
    "currentPage": 1,
    "totalPages": 5,
    "limit": 10
  },
  "data": [
    {
      "_id": "69ad65fbcd1b0d2b544b489e",
      "name": "John Smith",
      "email": "john.smith@vendorcompany.com",
      "phone": "+2348123456789",
      "role": "vendor",
      "manager": {
        "_id": "607f1f77bcf86cd799439011",
        "name": "Ahmed Hassan"
      },
      "isActive": true
    },
    {
      "_id": "69ad65fbcd1b0d2b544b48po",
      "name": "Jane Doe",
      "email": "jane.doe@vendorcompany.com",
      "role": "vendor",
      "manager": {
        "_id": "607f1f77bcf86cd799439012",
        "name": "Chioma Okoro"
      },
      "isActive": true
    }
  ]
}
```

✅ You can see the `manager` field shows which manager is assigned to each vendor

---

## Step 4: Update a Vendor's Manager (If Needed)

**If you need to reassign a vendor to a different manager**, use the update endpoint.

### API Call

```http
PUT /api/auth/vendor/:vendor_id
Authorization: Bearer <your_admin_token>
Content-Type: application/json

{
  "managerId": "607f1f77bcf86cd799439012"
}
```

### Example using curl

```bash
curl -X PUT "http://localhost:5000/api/auth/vendor/69ad65fbcd1b0d2b544b489e" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "managerId": "607f1f77bcf86cd799439012"
  }'
```

### Response (200 OK)

```json
{
  "success": true,
  "message": "Vendor updated successfully",
  "data": {
    "id": "69ad65fbcd1b0d2b544b489e",
    "name": "John Smith",
    "email": "john.smith@vendorcompany.com",
    "manager": {
      "_id": "607f1f77bcf86cd799439012",
      "name": "Chioma Okoro",
      "email": "chioma@bamihustle.com"
    }
  }
}
```

✅ Vendor is now assigned to a different manager

---

## Error Cases & Solutions

### ❌ Error: Manager is Required

```json
{
  "success": false,
  "message": "Manager is required. Please assign a manager to manage this vendor."
}
```

**Solution:** Include the `managerId` field in your request with a valid manager's ID.

---

### ❌ Error: Manager Not Found

```json
{
  "success": false,
  "message": "Manager not found"
}
```

**Solution:** The managerId you provided is incorrect or doesn't exist. Use GET /api/auth/managers to get valid manager IDs.

---

### ❌ Error: Selected User is Not a Valid Manager

```json
{
  "success": false,
  "message": "Selected user is not a valid manager"
}
```

**Solution:** The user ID you provided exists but is not a manager (might be a vendor, tenant, etc.). Use GET /api/auth/managers to select from actual managers.

---

### ❌ Error: User with This Email Already Exists

```json
{
  "success": false,
  "message": "User with this email already exists"
}
```

**Solution:** The vendor email you're trying to create already exists in the system. Use a different email address.

---

## Quick Reference: Complete Workflow

```
1. GET /api/auth/managers
   ↓
2. Admin selects a manager from the list
   ↓
3. POST /api/auth/onboard-vendor (with managerId)
   ↓
4. Vendor created ✅
5. Manager assigned ✅
6. Email sent to vendor ✅
   ↓
7. GET /api/auth/vendors (to verify)
```

---

## Tips for Admins

### ✅ Best Practices

1. **Always assign a manager when creating vendors** - It's required, not optional
2. **Verify manager exists** - Use GET /api/auth/managers first
3. **Check vendor email is unique** - Avoid "User with email already exists" errors
4. **Use pagination** - For large lists, use `page` and `limit` parameters
5. **Set sendCredentials = true** - Unless you want to send credentials separately

### ✅ Manager Assignment Strategy

- **Option 1: By Experience** - Assign experienced vendors to experienced managers
- **Option 2: By Specialty** - Group vendors by skill type with specialists managers
- **Option 3: By Workload** - Distribute vendors evenly across managers
- **Option 4: By Location** - Assign managers based on service area

---

## Testing the Feature

### Run the Test Suite

```bash
cd /path/to/BamiHustle-backend
node tests/test-vendor-manager-setup.js
```

This will:
- ✅ Create test data
- ✅ Test vendor creation with manager
- ✅ Test manager validation
- ✅ Test manager updates
- ✅ Display all results

---

## API Authentication

All endpoints requiring manager assignment need admin authentication:

```bash
# 1. Login as admin
POST /api/auth/login
{
  "email": "admin@bamihustle.com",
  "password": "YourPassword123!"
}

# 2. Copy the token from response
# 3. Use it in Authorization header:
Authorization: Bearer YOUR_TOKEN_HERE
```

---

## Support & Troubleshooting

### Common Questions

**Q: Can a vendor have multiple managers?**
A: No, a vendor can only be assigned to ONE manager at a time.

**Q: Can I change a vendor's manager after creation?**
A: Yes, use PUT /api/auth/vendor/:vendor_id with the new managerId.

**Q: What if I don't want to send credentials automatically?**
A: Set `sendCredentials: false` in the onboard request.

**Q: How do I create managers?**
A: Use POST /api/auth/onboard-manager (requires admin access).

---

## Summary

The vendor manager assignment system ensures:
- ✅ Every vendor has a designated manager
- ✅ Managers can be tracked and updated
- ✅ Clear validation and error messages
- ✅ Secure and audited onboarding process
- ✅ Easy-to-use API for admin operations

**You're ready to start assigning managers to vendors!**
