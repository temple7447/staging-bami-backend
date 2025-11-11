# Unit Management System - Implementation Guide

**Status**: In Progress  
**Purpose**: Manage property units separately from tenants

---

## Overview

The Unit Management System allows you to:
1. **Create units first** - Define all units in an estate
2. **Assign tenants to units** - When adding tenants, select from existing vacant units
3. **Track unit status** - vacant, occupied, maintenance, reserved

## Files Created

✅ **Unit Model** - `/models/Unit.js` (CREATED)
✅ **Unit Controller** - `/controllers/unitController.js` (IN PROGRESS)
✅ **Unit Routes** - `/routes/units.js` (IN PROGRESS)

---

## Step-by-Step Implementation

### Step 1: Copy Unit Controller Code

Create `/controllers/unitController.js` and paste this code:

```javascript
const Unit = require('../models/Unit');
const Estate = require('../models/Estate');
const Tenant = require('../models/Tenant');

/**
 * Create a new unit for an estate
 */
const createUnit = async (req, res) => {
  try {
    const { estateId } = req.params;
    const { label, monthlyPrice, meterNumber, description, features } = req.body;
    const adminId = req.user?.id;

    // Validation
    if (!label || !monthlyPrice) {
      return res.status(400).json({
        success: false,
        message: 'Unit label and monthly price are required'
      });
    }

    if (monthlyPrice <= 0) {
      return res.status(400).json({
        success: false,
        message: 'Monthly price must be greater than 0'
      });
    }

    // Verify estate exists
    const estate = await Estate.findById(estateId);
    if (!estate || !estate.isActive) {
      return res.status(404).json({
        success: false,
        message: 'Estate not found'
      });
    }

    // Check if unit already exists in this estate
    const existingUnit = await Unit.findOne({
      estate: estateId,
      label: label,
      isActive: true
    });

    if (existingUnit) {
      return res.status(409).json({
        success: false,
        message: `Unit "${label}" already exists in this estate`
      });
    }

    // Create new unit
    const unit = new Unit({
      estate: estateId,
      label,
      monthlyPrice,
      meterNumber: meterNumber || '',
      description: description || '',
      features: features || [],
      createdBy: adminId
    });

    await unit.save();
    await unit.populate('estate', 'name');

    res.status(201).json({
      success: true,
      message: 'Unit created successfully',
      data: {
        unitId: unit._id,
        label: unit.label,
        monthlyPrice: unit.monthlyPrice,
        meterNumber: unit.meterNumber,
        status: unit.status,
        estate: unit.estate.name
      }
    });
  } catch (error) {
    console.error('Create unit error:', error);
    res.status(500).json({
      success: false,
      message: 'Error creating unit',
      error: error.message
    });
  }
};

/**
 * Get all units for an estate
 */
const getEstateUnits = async (req, res) => {
  try {
    const { estateId } = req.params;
    const { status, page = 1, limit = 50 } = req.query;

    // Verify estate exists
    const estate = await Estate.findById(estateId);
    if (!estate) {
      return res.status(404).json({
        success: false,
        message: 'Estate not found'
      });
    }

    // Build filter
    const filter = { estate: estateId, isActive: true };
    if (status) {
      filter.status = status;
    }

    const skip = (parseInt(page) - 1) * parseInt(limit);
    const [units, total] = await Promise.all([
      Unit.find(filter)
        .populate('occupiedBy', 'tenantName tenantEmail')
        .sort({ label: 1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Unit.countDocuments(filter)
    ]);

    res.status(200).json({
      success: true,
      data: units.map(unit => ({
        unitId: unit._id,
        label: unit.label,
        monthlyPrice: unit.monthlyPrice,
        meterNumber: unit.meterNumber,
        description: unit.description,
        status: unit.status,
        occupiedBy: unit.occupiedBy ? {
          tenantId: unit.occupiedBy._id,
          name: unit.occupiedBy.tenantName,
          email: unit.occupiedBy.tenantEmail
        } : null,
        occupiedSince: unit.occupiedSince,
        createdAt: unit.createdAt
      })),
      pagination: {
        currentPage: parseInt(page),
        totalPages: Math.ceil(total / parseInt(limit)),
        totalItems: total
      },
      summary: {
        totalUnits: total,
        vacant: await Unit.countDocuments({ ...filter, status: 'vacant' }),
        occupied: await Unit.countDocuments({ ...filter, status: 'occupied' }),
        maintenance: await Unit.countDocuments({ ...filter, status: 'maintenance' }),
        reserved: await Unit.countDocuments({ ...filter, status: 'reserved' })
      }
    });
  } catch (error) {
    console.error('Get units error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching units',
      error: error.message
    });
  }
};

/**
 * Get vacant units (for tenant assignment dropdown)
 */
const getVacantUnits = async (req, res) => {
  try {
    const { estateId } = req.params;

    const estate = await Estate.findById(estateId);
    if (!estate) {
      return res.status(404).json({
        success: false,
        message: 'Estate not found'
      });
    }

    const vacantUnits = await Unit.find({
      estate: estateId,
      status: { $in: ['vacant', 'reserved'] },
      isActive: true
    }).sort({ label: 1 });

    res.status(200).json({
      success: true,
      data: vacantUnits.map(unit => ({
        unitId: unit._id,
        label: unit.label,
        monthlyPrice: unit.monthlyPrice,
        meterNumber: unit.meterNumber,
        status: unit.status,
        description: unit.description
      })),
      total: vacantUnits.length
    });
  } catch (error) {
    console.error('Get vacant units error:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching vacant units',
      error: error.message
    });
  }
};

module.exports = {
  createUnit,
  getEstateUnits,
  getVacantUnits
};
```

### Step 2: Copy Unit Routes

Create `/routes/units.js`:

```javascript
const express = require('express');
const { protect } = require('../middleware/auth');
const {
  validateObjectId,
  handleValidationErrors
} = require('../middleware/validation');
const {
  createUnit,
  getEstateUnits,
  getVacantUnits
} = require('../controllers/unitController');

const router = express.Router();

// Create unit for an estate
router.post('/:estateId/units', protect, validateObjectId, handleValidationErrors, createUnit);

// Get all units for an estate
router.get('/:estateId/units', protect, validateObjectId, handleValidationErrors, getEstateUnits);

// Get vacant units for tenant assignment
router.get('/:estateId/units/vacant', protect, validateObjectId, handleValidationErrors, getVacantUnits);

module.exports = router;
```

### Step 3: Server Routes Already Updated

The server.js has been updated with:
```javascript
app.use('/api/estates', require('./routes/units'));
```

---

## API Endpoints

### 1. Create Unit

```bash
POST /api/estates/{estateId}/units
Authorization: Bearer {TOKEN}
Content-Type: application/json

Body:
{
  "label": "Unit A1",
  "monthlyPrice": 150000,
  "meterNumber": "EM-12345",
  "description": "Ground floor unit",
  "features": [
    { "name": "Bedrooms", "value": "2" },
    { "name": "Bathrooms", "value": "1" }
  ]
}

Response (201):
{
  "success": true,
  "message": "Unit created successfully",
  "data": {
    "unitId": "507f1f77bcf86cd799439012",
    "label": "Unit A1",
    "monthlyPrice": 150000,
    "meterNumber": "EM-12345",
    "status": "vacant",
    "estate": "Sunshine Estate"
  }
}
```

### 2. Get All Units

```bash
GET /api/estates/{estateId}/units?status=vacant&page=1&limit=50
Authorization: Bearer {TOKEN}

Response (200):
{
  "success": true,
  "data": [
    {
      "unitId": "507f1f77bcf86cd799439012",
      "label": "Unit A1",
      "monthlyPrice": 150000,
      "status": "vacant",
      "occupiedBy": null
    },
    {
      "unitId": "507f1f77bcf86cd799439013",
      "label": "Unit A2",
      "monthlyPrice": 150000,
      "status": "occupied",
      "occupiedBy": {
        "tenantId": "...",
        "name": "John Doe",
        "email": "john@example.com"
      }
    }
  ],
  "summary": {
    "totalUnits": 20,
    "vacant": 15,
    "occupied": 5,
    "maintenance": 0,
    "reserved": 0
  }
}
```

### 3. Get Vacant Units (For Tenant Assignment)

```bash
GET /api/estates/{estateId}/units/vacant
Authorization: Bearer {TOKEN}

Response (200):
{
  "success": true,
  "data": [
    {
      "unitId": "507f1f77bcf86cd799439012",
      "label": "Unit A1",
      "monthlyPrice": 150000,
      "meterNumber": "EM-12345",
      "status": "vacant"
    }
  ],
  "total": 1
}
```

---

## Frontend Workflow

### Step 1: Admin creates units first

```javascript
// Create multiple units at once
const createUnits = async (estateId, unitsData) => {
  for (const unit of unitsData) {
    await fetch(`/api/estates/${estateId}/units`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(unit)
    });
  }
};

// Example usage
createUnits(estateId, [
  { label: 'Unit A1', monthlyPrice: 150000, meterNumber: 'EM-001' },
  { label: 'Unit A2', monthlyPrice: 150000, meterNumber: 'EM-002' },
  { label: 'Unit B1', monthlyPrice: 200000, meterNumber: 'EM-003' }
]);
```

### Step 2: When adding tenant, show vacant units

```javascript
// Get vacant units for dropdown
const getVacantUnitsForDropdown = async (estateId) => {
  const response = await fetch(`/api/estates/${estateId}/units/vacant`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  return response.json();
};

// In your tenant form, show dropdown:
<select name="unitId" required>
  <option value="">Select a unit</option>
  {vacantUnits.map(unit => (
    <option key={unit.unitId} value={unit.unitId}>
      {unit.label} - ₦{unit.monthlyPrice.toLocaleString()}
    </option>
  ))}
</select>
```

### Step 3: Use selected unit when creating tenant

```javascript
// When creating tenant, include unitId
const createTenant = async (tenantData) => {
  const response = await fetch(`/api/estates/${estateId}/tenants`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      ...tenantData,
      unitId: selectedUnit._id,  // From dropdown
      rentAmount: selectedUnit.monthlyPrice  // Auto-fill from unit
    })
  });
};
```

---

## Setup Checklist

- [x] Unit Model created (`/models/Unit.js`)
- [ ] Unit Controller created (`/controllers/unitController.js`)
- [ ] Unit Routes created (`/routes/units.js`)
- [ ] Server routes registered (DONE)
- [ ] Server logs updated (DONE)
- [ ] Test server starts
- [ ] Frontend dropdown implemented
- [ ] Tenant creation updated to use unitId

---

## Next Steps

1. **Copy the controller code** above into `/controllers/unitController.js`
2. **Copy the routes code** above into `/routes/units.js`
3. **Test the server**:
   ```bash
   npm run dev
   ```
4. **Test creating a unit**:
   ```bash
   curl -X POST http://localhost:5000/api/estates/{estateId}/units \
     -H "Authorization: Bearer {TOKEN}" \
     -H "Content-Type: application/json" \
     -d '{"label":"Unit A1", "monthlyPrice":150000}'
   ```
5. **Update frontend** to use vacant units dropdown when adding tenants

---

**Status**: Follow the steps above to complete the implementation  
**Time to Complete**: ~15 minutes  
**Difficulty**: Easy
