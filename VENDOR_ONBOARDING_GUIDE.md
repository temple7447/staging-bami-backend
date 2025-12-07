# Business Types & Vendor Management - Complete Guide

## Overview

Admins can now create and manage business types (e.g., Plumbing, Electrical, Carpentry) and assign them to vendors during onboarding.

---

## Part 1: Business Type Management

### 1. Create Business Type
**POST** `/api/business-types`

**Access:** Admin or Super Admin

**Request Body:**
```json
{
  "name": "Plumbing",
  "description": "Plumbing and water-related services"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Business type created successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439011",
    "name": "Plumbing",
    "description": "Plumbing and water-related services",
    "isActive": true,
    "createdAt": "2025-12-07T11:04:00.000Z"
  }
}
```

---

### 2. Get All Business Types
**GET** `/api/business-types`

**Access:** Any authenticated user

**Query Parameters:**
- `page` (default: 1)
- `limit` (default: 50)
- `activeOnly` (default: true)

**Response:**
```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Plumbing",
      "description": "Plumbing and water-related services",
      "isActive": true,
      "createdAt": "2025-12-07T11:04:00.000Z"
    },
    {
      "_id": "507f1f77bcf86cd799439012",
      "name": "Electrical",
      "description": "Electrical installations and repairs",
      "isActive": true,
      "createdAt": "2025-12-07T11:05:00.000Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 1,
    "totalItems": 5
  }
}
```

---

### 3. Update Business Type
**PUT** `/api/business-types/:id`

**Access:** Admin or Super Admin

**Request Body:**
```json
{
  "name": "Plumbing Services",
  "description": "Updated description"
}
```

---

### 4. Delete Business Type
**DELETE** `/api/business-types/:id`

**Access:** Admin or Super Admin

**Note:** This is a soft delete (sets `isActive: false`)

---

## Part 2: Vendor Onboarding with Business Type

### Onboard Vendor (Updated)
**POST** `/api/auth/onboard-vendor`

**Access:** Admin or Super Admin

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "vendor@example.com",
  "phone": "08012345678",
  "businessTypeId": "507f1f77bcf86cd799439011",
  "businessName": "John's Plumbing Services",
  "specialization": "Residential Plumbing",
  "sendCredentials": true
}
```

**Required Fields:**
- `name` (string, 2-50 characters)
- `email` (valid email)

**Optional Fields:**
- `phone` (mobile phone number)
- `businessTypeId` (MongoDB ObjectId - must be a valid business type)
- `businessName` (string)
- `specialization` (string)
- `sendCredentials` (boolean, default: true)

**Response:**
```json
{
  "success": true,
  "message": "Vendor onboarded successfully. Credentials sent to vendor@example.com",
  "data": {
    "id": "507f1f77bcf86cd799439013",
    "name": "John Doe",
    "email": "vendor@example.com",
    "phone": "08012345678",
    "role": "vendor",
    "businessType": "Plumbing",
    "businessName": "John's Plumbing Services",
    "specialization": "Residential Plumbing",
    "isActive": true,
    "createdAt": "2025-12-07T11:10:00.000Z"
  }
}
```

---

## Workflow Example

### Step 1: Create Business Types

```bash
# Create Plumbing business type
curl -X POST http://localhost:8080/api/business-types \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Plumbing",
    "description": "Plumbing and water-related services"
  }'

# Create Electrical business type
curl -X POST http://localhost:8080/api/business-types \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Electrical",
    "description": "Electrical installations and repairs"
  }'

# Create Carpentry business type
curl -X POST http://localhost:8080/api/business-types \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Carpentry",
    "description": "Woodwork and furniture services"
  }'
```

---

### Step 2: Get Business Types List

```bash
curl http://localhost:8080/api/business-types \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN"
```

**Response will include IDs you need for vendor onboarding:**
```json
{
  "data": [
    { "_id": "675456a1b2c3d4e5f6789012", "name": "Plumbing" },
    { "_id": "675456a1b2c3d4e5f6789013", "name": "Electrical" },
    { "_id": "675456a1b2c3d4e5f6789014", "name": "Carpentry" }
  ]
}
```

---

### Step 3: Onboard Vendor with Business Type

```bash
curl -X POST http://localhost:8080/api/auth/onboard-vendor \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Jane Smith",
    "email": "jane@plumbing.com",
    "phone": "08098765432",
    "businessTypeId": "675456a1b2c3d4e5f6789012",
    "businessName": "Smith Plumbing Co.",
    "specialization": "Commercial Plumbing"
  }'
```

---

## Frontend Integration

### Dropdown Implementation

```javascript
// 1. Fetch business types for dropdown
const fetchBusinessTypes = async () => {
  const response = await fetch('/api/business-types', {
    headers: {
      'Authorization': `Bearer ${token}`
    }
  });
  const data = await response.json();
  return data.data; // Array of business types
};

// 2. Render dropdown
<select name="businessTypeId">
  <option value="">Select Business Type</option>
  {businessTypes.map(type => (
    <option key={type._id} value={type._id}>
      {type.name}
    </option>
  ))}
</select>

// 3. Submit vendor form
const onboardVendor = async (formData) => {
  const response = await fetch('/api/auth/onboard-vendor', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: formData.name,
      email: formData.email,
      phone: formData.phone,
      businessTypeId: formData.businessTypeId, // Selected from dropdown
      businessName: formData.businessName,
      specialization: formData.specialization
    })
  });
  return response.json();
};
```

---

## Key Features

✅ **Business Type Management** - Create, list, update, delete business types  
✅ **Dropdown Selection** - Vendors select from predefined business types  
✅ **Validation** - Ensures selected business type exists and is active  
✅ **Email Integration** - Business type name included in welcome email  
✅ **Soft Delete** - Business types can be deactivated without data loss  
✅ **Pagination** - Efficient listing of business types  

---

## API Endpoints Summary

| Method | Endpoint | Access | Description |
|--------|----------|--------|-------------|
| POST | `/api/business-types` | Admin | Create business type |
| GET | `/api/business-types` | Authenticated | List all business types |
| GET | `/api/business-types/:id` | Authenticated | Get single business type |
| PUT | `/api/business-types/:id` | Admin | Update business type |
| DELETE | `/api/business-types/:id` | Admin | Delete business type |
| POST | `/api/auth/onboard-vendor` | Admin | Onboard vendor with business type |

---

## Files Created/Modified

1. **NEW** [models/BusinessType.js](file:///Users/temple/Documents/Bami/BamiHustle-backend/models/BusinessType.js)
2. **NEW** [controllers/businessTypeController.js](file:///Users/temple/Documents/Bami/BamiHustle-backend/controllers/businessTypeController.js)
3. **NEW** [routes/businessTypes.js](file:///Users/temple/Documents/Bami/BamiHustle-backend/routes/businessTypes.js)
4. **MODIFIED** [server.js](file:///Users/temple/Documents/Bami/BamiHustle-backend/server.js) - Added business types route
5. **MODIFIED** [controllers/authController.js](file:///Users/temple/Documents/Bami/BamiHustle-backend/controllers/authController.js) - Updated vendor onboarding
6. **MODIFIED** [routes/auth.js](file:///Users/temple/Documents/Bami/BamiHustle-backend/routes/auth.js) - Updated validation

🎉 **Business type management system is ready!**
