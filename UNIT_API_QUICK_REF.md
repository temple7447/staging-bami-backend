# Unit Management API - Quick Reference

**Status**: ✅ **LIVE & READY TO USE**

---

## How It Works

### Old System (Manual):
```
Add Tenant → Manually type "Unit A1" → Manually enter rent amount ❌
```

### New System (Better):
```
Create Units First → Select Unit from Dropdown → Rent auto-fills → Add Tenant ✅
```

---

## 3 Main Endpoints

### 1️⃣ Create a Unit

```bash
POST /api/estates/{estateId}/units

Body:
{
  "label": "Unit A1",
  "monthlyPrice": 150000,
  "meterNumber": "EM-12345",
  "description": "Ground floor 2-bedroom"
}

Response:
{
  "unitId": "507f...",
  "label": "Unit A1",
  "monthlyPrice": 150000,
  "status": "vacant"
}
```

### 2️⃣ Get Vacant Units (For Dropdown)

```bash
GET /api/estates/{estateId}/units/vacant

Response:
{
  "data": [
    {
      "unitId": "507f...",
      "label": "Unit A1",
      "monthlyPrice": 150000,
      "meterNumber": "EM-12345",
      "status": "vacant"
    },
    {
      "unitId": "507f...",
      "label": "Unit A2",
      "monthlyPrice": 150000,
      "status": "vacant"
    }
  ],
  "total": 2
}
```

### 3️⃣ Get All Units

```bash
GET /api/estates/{estateId}/units?status=vacant

Response:
{
  "data": [
    {
      "unitId": "507f...",
      "label": "Unit A1",
      "monthlyPrice": 150000,
      "status": "vacant",
      "occupiedBy": null
    },
    {
      "unitId": "507f...",
      "label": "Unit A2",
      "monthlyPrice": 150000,
      "status": "occupied",
      "occupiedBy": {
        "name": "John Doe",
        "email": "john@example.com"
      }
    }
  ],
  "summary": {
    "totalUnits": 20,
    "vacant": 15,
    "occupied": 5
  }
}
```

---

## Frontend Integration (Vue.js Example)

### Step 1: Create Units

```javascript
const createUnits = async () => {
  const unitsData = [
    { label: 'Unit A1', monthlyPrice: 150000, meterNumber: 'EM-001' },
    { label: 'Unit A2', monthlyPrice: 150000, meterNumber: 'EM-002' },
    { label: 'Unit B1', monthlyPrice: 200000, meterNumber: 'EM-003' }
  ];

  for (const unit of unitsData) {
    await fetch(`/api/estates/${estateId}/units`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}` },
      body: JSON.stringify(unit)
    });
  }
};
```

### Step 2: Load Vacant Units for Dropdown

```javascript
async mounted() {
  const response = await fetch(`/api/estates/${estateId}/units/vacant`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  this.vacantUnits = (await response.json()).data;
}
```

### Step 3: Add Tenant with Selected Unit

```javascript
<template>
  <form @submit="addTenant">
    <!-- Unit Dropdown -->
    <select v-model="selectedUnit" required>
      <option value="">Select Unit</option>
      <option v-for="unit in vacantUnits" :key="unit.unitId" :value="unit">
        {{ unit.label }} - ₦{{ unit.monthlyPrice.toLocaleString() }}
      </option>
    </select>

    <!-- Rent auto-fills -->
    <input v-model="form.rentAmount" type="number" :value="selectedUnit.monthlyPrice" />
    <input v-model="form.unitLabel" :value="selectedUnit.label" readonly />
    
    <button type="submit">Add Tenant</button>
  </form>
</template>

<script>
async addTenant() {
  const response = await fetch(`/api/estates/${estateId}/tenants`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${token}` },
    body: JSON.stringify({
      tenantName: this.form.tenantName,
      tenantEmail: this.form.tenantEmail,
      unitLabel: this.selectedUnit.label,
      rentAmount: this.selectedUnit.monthlyPrice
    })
  });
}
</script>
```

---

## Unit Statuses

| Status | Meaning |
|--------|---------|
| `vacant` | No tenant, ready to assign |
| `occupied` | Tenant currently living there |
| `maintenance` | Undergoing repairs |
| `reserved` | Reserved for future tenant |

---

## Complete API Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| **POST** | `/api/estates/{estateId}/units` | Create unit |
| **GET** | `/api/estates/{estateId}/units` | List all units (paginated) |
| **GET** | `/api/estates/{estateId}/units/vacant` | Get vacant units only (for dropdown) |
| **GET** | `/api/estates/unit/{unitId}` | Get unit details |
| **PUT** | `/api/estates/unit/{unitId}` | Update unit |
| **POST** | `/api/estates/unit/{unitId}/assign-tenant` | Assign tenant to unit |
| **POST** | `/api/estates/unit/{unitId}/remove-tenant` | Remove tenant (vacancy) |
| **DELETE** | `/api/estates/unit/{unitId}` | Delete unit |

---

## Query Parameters

### For Get All Units
```bash
GET /api/estates/{estateId}/units?status=vacant&page=1&limit=50

Parameters:
- status: filter by 'vacant', 'occupied', 'maintenance', or 'reserved'
- page: page number (default: 1)
- limit: items per page (default: 50)
```

---

## Testing with cURL

### Create unit
```bash
curl -X POST http://localhost:5000/api/estates/ESTATE_ID/units \
  -H "Authorization: Bearer TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "label": "Unit A1",
    "monthlyPrice": 150000,
    "meterNumber": "EM-001"
  }'
```

### Get vacant units
```bash
curl -X GET "http://localhost:5000/api/estates/ESTATE_ID/units/vacant" \
  -H "Authorization: Bearer TOKEN"
```

### Get all units
```bash
curl -X GET "http://localhost:5000/api/estates/ESTATE_ID/units?status=vacant" \
  -H "Authorization: Bearer TOKEN"
```

---

## Summary

✅ **Files Created**:
- `/models/Unit.js` - Unit database model
- `/controllers/unitController.js` - Unit business logic
- `/routes/units.js` - Unit API endpoints

✅ **Features**:
- Create units with price, meter number, description
- Track unit status (vacant/occupied/maintenance/reserved)
- Get vacant units for tenant assignment dropdown
- Filter units by status
- Pagination support

✅ **Ready to Use**:
- Server running with all endpoints active
- All 8 unit endpoints available
- Works seamlessly with tenant creation

---

**Next**: Update your frontend to use the vacant units dropdown when adding tenants!
