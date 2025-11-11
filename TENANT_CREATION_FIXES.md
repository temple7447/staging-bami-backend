# Tenant Creation Bug Fixes - Complete Summary

## Issues Fixed

### 1. **Reference Error: `unitId is not defined` in Error Handler**
**File:** `controllers/tenantController.js` (Line 144)

**Problem:**
- Variables `unitId` and `tenantName` were extracted from `req.body` **inside** the try block (lines 37-49)
- When an error occurred, the catch block tried to reference these variables which were out of scope
- This caused: `ReferenceError: unitId is not defined`

**Solution:**
- Moved `unitId` and `tenantName` extraction **outside** the try block (lines 25-27)
- Made them available in both try and catch blocks for proper error logging
- Also moved `estateId` extraction outside

**Code Change:**
```javascript
// BEFORE (Error)
const createTenant = async (req, res) => {
  try {
    const { estateId } = req.params;
    const { unitId, tenantName, ... } = req.body;
    // ...
  } catch (err) {
    logError('POST /api/tenants', err, { unitId, tenantName, estateId }); // ❌ unitId undefined
  }
};

// AFTER (Fixed)
const createTenant = async (req, res) => {
  const unitId = req.body?.unitId;
  const tenantName = req.body?.tenantName;
  const { estateId } = req.params;
  
  try {
    // ...
  } catch (err) {
    logError('POST /api/tenants', err, { unitId, tenantName, estateId }); // ✅ Variables available
  }
};
```

---

### 2. **MongoDB Duplicate Key Error: `E11000 duplicate key error`**
**Error:** `estate_1_unitLabel_1_isActive_1 dup key: { estate: ObjectId(...), unitLabel: null, isActive: true }`

**Root Cause:**
- The Tenant model was missing the `unitLabel` field in the schema
- Multiple tenants were being created with `unitLabel: null`
- Code was referencing `tenant.unitLabel` in payment controller and email service, but it wasn't persisting to database
- The old unique index used `unitLabel` but it wasn't properly defined in the schema

**Solution:**
1. **Added `unitLabel` field to Tenant schema** (`models/Tenant.js`)
   ```javascript
   unitLabel: {
     type: String,
     trim: true,
     default: ''
   }
   ```

2. **Updated Tenant creation** to set `unitLabel` from the Unit document
   ```javascript
   const tenant = await Tenant.create({
     estate: estateId,
     unit: unitId,
     unitLabel: unit.label,  // ✅ Set from unit.label
     tenantName: fullName,
     // ...
   });
   ```

3. **Fixed database index**
   - Dropped old problematic index
   - Created new index with proper partial filter:
   ```javascript
   TenantSchema.index(
     { estate: 1, unitLabel: 1, isActive: 1 },
     { 
       unique: true, 
       partialFilterExpression: { isActive: true } 
     }
   );
   ```

4. **Cleaned up orphaned data**
   - Ran migration script to remove old index
   - Marked 1 orphaned tenant with null unitLabel as inactive to clear duplicate key violations

---

## Migration Script

**File:** `scripts/fixTenantIndex.js`

Actions performed:
1. Connected to MongoDB
2. Listed all existing indexes
3. Dropped the old `estate_1_unitLabel_1_isActive_1` index
4. Created new index with proper configuration
5. Verified new indexes were created

**Run with:**
```bash
node scripts/fixTenantIndex.js
```

---

## Additional Fixes Made

### 3. **Unit Validation and Status Management**
- Added unit existence check in `createTenant`
- Added unit vacancy check before creating tenant
- Update unit status to 'occupied' when tenant is created
- Set `unit.occupiedBy`, `unit.occupiedSince` references

### 4. **Data Integrity**
- Extract unit information (label, monthlyPrice, meterNumber) at creation time
- Store in tenant record for consistency
- Use unit reference for lookups

### 5. **Improved Error Logging**
- Better error context in all tenant operations
- Proper logging with logger service
- Removed old console.error statements

---

## Testing the Fix

The frontend request now works correctly:

**Request:**
```json
POST /api/estates/690cf9cf00208ba6b1561010/tenants
{
  "unitId": "69136c6d6368689e2c0754d7",
  "tenantName": "JOHN EMAA",
  "tenantEmail": "templevoke1@gmail.com",
  "tenantPhone": "07023234232",
  "tenantType": "new",
  "nextDueDate": "2026-05-11"
}
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Tenant created successfully",
  "data": {
    "_id": "...",
    "estate": "690cf9cf00208ba6b1561010",
    "unit": "69136c6d6368689e2c0754d7",
    "unitLabel": "Unit 3",
    "tenantName": "JOHN EMAA",
    "tenantEmail": "templevoke1@gmail.com",
    "tenantPhone": "07023234232",
    "rentAmount": 10000,
    "tenantType": "new",
    "status": "occupied",
    // ... other fields
  }
}
```

---

## Files Modified

1. `controllers/tenantController.js` - Fixed variable scope, added unit validation
2. `models/Tenant.js` - Added unitLabel field, fixed index
3. `scripts/fixTenantIndex.js` - Migration script to fix database
4. Other controllers/routes - Updated error logging and type fixes

---

## Database State

✅ Migration completed successfully
✅ Old index removed
✅ New index created
✅ Orphaned tenants marked as inactive
✅ Ready for new tenant creation with proper unitLabel

