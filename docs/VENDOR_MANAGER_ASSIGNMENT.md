# Vendor Manager Assignment Feature Documentation

## Overview
The vendor manager assignment feature allows administrators to assign a manager to a vendor during the onboarding process. This ensures that each vendor has a dedicated manager responsible for their operations and performance.

## Feature Status
✅ **ALREADY IMPLEMENTED** - No additional code changes required

## System Components

### 1. Data Model
**Location:** `models/User.js` (lines 153-156)

```javascript
// For vendor role - assigned manager who manages this vendor
manager: {
  type: mongoose.Schema.ObjectId,
  ref: 'User'
}
```

- **Type:** MongoDB ObjectId reference
- **Referes to:** User collection (another User with role: 'manager' or 'super_manager')
- **Nullable:** Yes (optional during initial setup, but required for functioning vendor)

### 2. API Endpoints

#### A. Onboard Vendor with Manager Assignment
**Endpoint:** `POST /api/auth/onboard-vendor`
**Authentication:** Required (Admin or Super Admin)
**Access Control:** `adminOrSuperAdmin` middleware

**Request Body:**
```json
{
  "name": "John Doe",
  "email": "vendor@example.com",
  "phone": "+2348123456789",
  "position": "Senior Electrician",
  "managerId": "507f1f77bcf86cd799439011",
  "sendCredentials": true
}
```

**Required Fields:**
- `name` - Vendor's full name
- `email` - Valid, unique email address
- `managerId` - **REQUIRED** - Must be a valid User ID with role 'manager' or 'super_manager'

**Optional Fields:**
- `phone` - Contact phone number
- `position` - Job position/title
- `sendCredentials` - Whether to send welcome email with credentials (default: true)

**Success Response (201):**
```json
{
  "success": true,
  "message": "Vendor onboarded successfully. Credentials sent to vendor@example.com",
  "data": {
    "id": "507f1f77bcf86cd799439012",
    "name": "John Doe",
    "email": "vendor@example.com",
    "phone": "+2348123456789",
    "position": "Senior Electrician",
    "role": "vendor",
    "manager": {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Manager Name",
      "email": "manager@example.com"
    },
    "isActive": true,
    "createdAt": "2026-03-08T10:30:00.000Z"
  }
}
```

**Error Responses:**

1. **Missing Manager ID (400):**
```json
{
  "success": false,
  "message": "Manager is required. Please assign a manager to manage this vendor."
}
```

2. **Invalid Manager ID (400):**
```json
{
  "success": false,
  "message": "Manager not found"
}
```

3. **Manager with Invalid Role (400):**
```json
{
  "success": false,
  "message": "Selected user is not a valid manager"
}
```

#### B. Get Available Managers
**Endpoint:** `GET /api/auth/managers`
**Authentication:** Required (Admin or Super Admin)
**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Results per page (default: 20)

**Success Response (200):**
```json
{
  "success": true,
  "count": 2,
  "total": 2,
  "pagination": {
    "currentPage": 1,
    "totalPages": 1,
    "limit": 20
  },
  "data": [
    {
      "_id": "507f1f77bcf86cd799439011",
      "name": "Manager One",
      "email": "manager1@example.com",
      "position": "Operations Manager",
      "role": "manager",
      "isActive": true,
      "createdAt": "2026-03-01T10:00:00.000Z"
    },
    {
      "_id": "507f1f77bcf86cd799439013",
      "name": "Manager Two",
      "email": "manager2@example.com",
      "position": "Super Manager",
      "role": "super_manager",
      "isActive": true,
      "createdAt": "2026-03-02T10:00:00.000Z"
    }
  ]
}
```

#### C. Get Vendors
**Endpoint:** `GET /api/auth/vendors`
**Authentication:** Required (Admin or Super Admin)
**Query Parameters:**
- `page` - Page number (default: 1)
- `limit` - Results per page (default: 20)

**Success Response (200):**
```json
{
  "success": true,
  "count": 1,
  "total": 1,
  "data": [
    {
      "_id": "507f1f77bcf86cd799439012",
      "name": "John Doe",
      "email": "vendor@example.com",
      "phone": "+2348123456789",
      "role": "vendor",
      "manager": {
        "_id": "507f1f77bcf86cd799439011",
        "name": "Manager Name",
        "email": "manager@example.com"
      },
      "isActive": true,
      "createdAt": "2026-03-08T10:30:00.000Z"
    }
  ]
}
```

#### D. Update Vendor Manager
**Endpoint:** `PUT /api/auth/vendor/:id`
**Authentication:** Required (Admin or Super Admin)
**Route Parameter:** `:id` - Vendor's user ID

**Request Body:**
```json
{
  "managerId": "507f1f77bcf86cd799439013"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "message": "Vendor updated successfully",
  "data": {
    "_id": "507f1f77bcf86cd799439012",
    "name": "John Doe",
    "email": "vendor@example.com",
    "role": "vendor",
    "manager": {
      "_id": "507f1f77bcf86cd799439013",
      "name": "New Manager",
      "email": "newmanager@example.com"
    }
  }
}
```

## Validation Rules

### Manager Assignment Validation
1. **Manager ID is REQUIRED** when creating a vendor
2. **Manager must exist** in the database
3. **Manager must have valid role:**
   - `'manager'` - Regular manager role
   - `'super_manager'` - Super manager role
4. **Cannot use users with other roles** (admin, vendor, tenant, etc.)

### Error Handling
- Invalid manager ID → 400 Bad Request
- Manager not found → 400 Bad Request
- Manager with invalid role → 400 Bad Request
- Missing manager ID → 400 Bad Request

## Database Relationships

```
User (Manager)
├─ name
├─ email
├─ role: 'manager' | 'super_manager'
└─ ...

User (Vendor)
├─ name
├─ email
├─ role: 'vendor'
├─ manager: ObjectId → User (Manager)
└─ ...
```

## Usage Flow

### Admin Workflow:
1. **Fetch Available Managers**
   ```bash
   curl -X GET http://localhost:5000/api/auth/managers \
     -H "Authorization: Bearer {token}" \
     -H "Content-Type: application/json"
   ```

2. **Choose a Manager** from the list

3. **Create Vendor with Manager**
   ```bash
   curl -X POST http://localhost:5000/api/auth/onboard-vendor \
     -H "Authorization: Bearer {token}" \
     -H "Content-Type: application/json" \
     -d '{
       "name": "John Doe",
       "email": "john@example.com",
       "phone": "+2348123456789",
       "position": "Senior Electrician",
       "managerId": "507f1f77bcf86cd799439011"
     }'
   ```

4. **Verify Vendor Creation**
   ```bash
   curl -X GET http://localhost:5000/api/auth/vendors \
     -H "Authorization: Bearer {token}"
   ```

5. **Update Manager (if needed)**
   ```bash
   curl -X PUT http://localhost:5000/api/auth/vendor/{vendorId} \
     -H "Authorization: Bearer {token}" \
     -d '{
       "managerId": "507f1f77bcf86cd799439013"
     }'
   ```

## Testing

### Run Test Suite
```bash
# Run the vendor manager assignment test
node tests/test-vendor-manager-assignment.js

# Run with custom base URL
BASE_URL=http://your-server:port node tests/test-vendor-manager-assignment.js
```

### Test Coverage
- ✅ Authentication (Super Admin login)
- ✅ Get available managers
- ✅ Onboard vendor with valid manager
- ✅ Verify manager assignment in response
- ✅ Verify manager persists in database
- ✅ Reject vendor without manager
- ✅ Reject vendor with invalid manager ID
- ✅ Reject vendor with duplicate email
- ✅ Update vendor's manager
- ✅ Fetch vendors and verify manager association
- ✅ Complete workflow test

## Security Considerations

1. **Authentication Required:** All endpoints require valid JWT token
2. **Authorization:** Only Admin and Super Admin can manage vendors
3. **Manager Validation:** Manager must have explicit role
4. **Email Uniqueness:** Each vendor must have unique email
5. **Credentials Security:** Temporary password generated and sent via email
6. **Audit Trail:** `createdBy` field tracks who created the vendor

## Error Scenarios

| Scenario | HTTP Status | Error Message |
|----------|------------|---------------|
| Missing manager ID | 400 | Manager is required. Please assign a manager... |
| Invalid manager ID | 400 | Manager not found |
| Manager wrong role | 400 | Selected user is not a valid manager |
| Duplicate email | 400 | User with this email already exists |
| Unauthorized | 401 | Not authenticated |
| Forbidden | 403 | Only admins can perform this action |

## Best Practices

1. **Always verify manager exists** before creating vendor
2. **Use manager list endpoint** to get available managers
3. **Handle temporary passwords securely** - ensure vendor changes password on first login
4. **Monitor manager assignments** - ensure workload distribution
5. **Log all manager changes** for audit trail
6. **Validate email format** before sending to API
7. **Test with different managers** to ensure flexibility

## Related Features

- **Manager Onboarding:** `POST /api/auth/onboard-manager`
- **Vendor Profile:** Vendor can view/update their own profile
- **Manager Dashboard:** Manager can view assigned vendors
- **Vendor Notifications:** Vendors receive alerts about manager assignments
- **Audit Logs:** Tracks all manager assignment changes

## Troubleshooting

### Issue: "Manager not found"
- **Solution:** Verify manager ID exists in database
- **Check:** Run GET /api/auth/managers to see available managers

### Issue: "Selected user is not a valid manager"
- **Solution:** The user must have role 'manager' or 'super_manager'
- **Check:** Verify user's role in database

### Issue: Manager assignment not persisting
- **Solution:** Check database connection and permissions
- **Check:** Verify vendor record in mongodb

### Issue: Email not sent to vendor
- **Solution:** Check email service configuration
- **Check:** Set `sendCredentials: false` if email service is down, then send manually

## Support

For issues or questions:
1. Check API documentation above
2. Review error messages carefully
3. Check application logs
4. Verify database connectivity
5. Test with curl commands manually

---

**Last Updated:** 2026-03-08
**Feature Status:** Production Ready ✅
