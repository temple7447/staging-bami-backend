# Separate Folder Type Endpoints - Complete Example

This document demonstrates the new **separate endpoints** for creating different types of folders in the BamiHustle Knowledge Library system. Each folder type (Parent, Child, Grandchild) now has its own dedicated endpoint for clearer development and better validation.

## Overview

The system now provides **4 ways to create folders**:

### **1. Specific Type Endpoints (Recommended)**
- `POST /api/folders/parent` - Create parent folder (Level 0)
- `POST /api/folders/child` - Create child folder (Level 1) 
- `POST /api/folders/grandchild` - Create grandchild folder (Level 2)

### **2. Generic Endpoint (Backward Compatible)**
- `POST /api/folders` - Create any folder type (auto-detects based on parentFolder)

## Folder Hierarchy Rules

- **Level 0 (Parent)**: Root-level containers, can only contain child folders
- **Level 1 (Child)**: Must have a parent folder, can only contain grandchild folders
- **Level 2 (Grandchild)**: Must have a child folder as parent, **can contain materials**, cannot have subfolders

---

## Authentication

All requests require JWT authentication:
```http
Authorization: Bearer <your_jwt_token>
```

---

## Step 1: Create Parent Folder (Level 0)

### Request
```http
POST /api/folders/parent
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "name": "Sales & Marketing",
  "description": "All sales and marketing related materials and resources",
  "icon": "megaphone",
  "color": "#28a745",
  "order": 1,
  "visibility": "public",
  "isProtected": false
}
```

### Enhanced Morgan Logging Output
```
💼 PARENT FOLDER OPERATION (Level 0):
   Method: POST
   Path: /api/folders/parent
   Query: {}
   Body: {
     "name": "Sales & Marketing",
     "description": "All sales and marketing related materials and resources",
     "icon": "megaphone",
     "color": "#28a745",
     "order": 1,
     "visibility": "public",
     "isProtected": false
   }
   User: John Doe (67f1a2b3c4d5e6f7g8h9i0j1)
   Time: 2024-01-15T10:00:00.000Z
   ℹ️  Parent folders are created at root level and can only contain child folders

[PARENT-FOLDER-API] POST /api/folders/parent 201 42 ms - 1247 bytes User:67f1a2b3c4d5e6f7g8h9i0j1 {...}
```

### Response
```json
{
  "success": true,
  "message": "Parent folder created successfully",
  "data": {
    "_id": "67f5a8b2c3d4e5f6g7h8i9j0",
    "name": "Sales & Marketing",
    "slug": "sales-marketing",
    "description": "All sales and marketing related materials and resources",
    "parentFolder": null,
    "level": 0,
    "fullPath": "Sales & Marketing",
    "icon": "megaphone",
    "color": "#28a745",
    "isActive": true,
    "order": 1,
    "materialCount": 0,
    "subfolderCount": 0,
    "totalSize": 0,
    "visibility": "public",
    "allowedRoles": [],
    "isProtected": false,
    "allowMaterials": false,
    "folderType": "parent",
    "canHaveSubfolders": true,
    "canHaveMaterials": false,
    "createdBy": {
      "_id": "67f1a2b3c4d5e6f7g8h9i0j1",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "createdAt": "2024-01-15T10:00:00.000Z",
    "updatedAt": "2024-01-15T10:00:00.000Z"
  }
}
```

### Key Differences from Generic Endpoint:
- ✅ **No parentFolder field allowed** - Validation prevents it
- ✅ **Level automatically set to 0**
- ✅ **allowMaterials automatically set to false**
- ✅ **Clear error messages specific to parent folders**
- ✅ **Enhanced logging with parent folder context**

---

## Step 2: Create Child Folder (Level 1)

### Request
```http
POST /api/folders/child
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "name": "Digital Marketing",
  "description": "Digital marketing strategies, campaigns, and resources",
  "parentFolder": "67f5a8b2c3d4e5f6g7h8i9j0",
  "icon": "monitor",
  "color": "#17a2b8",
  "order": 1,
  "visibility": "public",
  "isProtected": false
}
```

### Enhanced Morgan Logging Output
```
📋 CHILD FOLDER OPERATION (Level 1):
   Method: POST
   Path: /api/folders/child
   Query: {}
   Body: {
     "name": "Digital Marketing",
     "description": "Digital marketing strategies, campaigns, and resources",
     "parentFolder": "67f5a8b2c3d4e5f6g7h8i9j0",
     "icon": "monitor",
     "color": "#17a2b8",
     "order": 1,
     "visibility": "public",
     "isProtected": false
   }
   🔗 Parent Folder ID: 67f5a8b2c3d4e5f6g7h8i9j0
   User: John Doe (67f1a2b3c4d5e6f7g8h9i0j1)
   Time: 2024-01-15T10:05:00.000Z
   ℹ️  Child folders must be created under parent folders (level 0)

[CHILD-FOLDER-API] POST /api/folders/child 201 38 ms - 1354 bytes User:67f1a2b3c4d5e6f7g8h9i0j1 {...}
```

### Response
```json
{
  "success": true,
  "message": "Child folder created successfully",
  "data": {
    "_id": "67f5a8b2c3d4e5f6g7h8i9j1",
    "name": "Digital Marketing",
    "slug": "digital-marketing",
    "description": "Digital marketing strategies, campaigns, and resources",
    "parentFolder": {
      "_id": "67f5a8b2c3d4e5f6g7h8i9j0",
      "name": "Sales & Marketing",
      "slug": "sales-marketing",
      "fullPath": "Sales & Marketing",
      "level": 0
    },
    "level": 1,
    "fullPath": "Sales & Marketing/Digital Marketing",
    "icon": "monitor",
    "color": "#17a2b8",
    "isActive": true,
    "order": 1,
    "materialCount": 0,
    "subfolderCount": 0,
    "totalSize": 0,
    "visibility": "public",
    "allowedRoles": [],
    "isProtected": false,
    "allowMaterials": false,
    "folderType": "child",
    "canHaveSubfolders": true,
    "canHaveMaterials": false,
    "createdBy": {
      "_id": "67f1a2b3c4d5e6f7g8h9i0j1",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "createdAt": "2024-01-15T10:05:00.000Z",
    "updatedAt": "2024-01-15T10:05:00.000Z"
  }
}
```

### Key Differences from Generic Endpoint:
- ✅ **parentFolder field required** - Validation enforces it
- ✅ **Validates parent is actually a Level 0 folder**
- ✅ **Level automatically set to 1**
- ✅ **allowMaterials automatically set to false**
- ✅ **Clear error messages specific to child folders**
- ✅ **Enhanced logging shows parent folder ID**

---

## Step 3: Create Grandchild Folder (Level 2) - Can Hold Materials

### Request
```http
POST /api/folders/grandchild
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "name": "Social Media",
  "description": "Social media marketing materials, templates, and guides",
  "parentFolder": "67f5a8b2c3d4e5f6g7h8i9j1",
  "icon": "users",
  "color": "#6f42c1",
  "order": 1,
  "allowMaterials": true,
  "isProtected": true
}
```

### Enhanced Morgan Logging Output
```
📁 GRANDCHILD FOLDER OPERATION (Level 2):
   Method: POST
   Path: /api/folders/grandchild
   Query: {}
   Body: {
     "name": "Social Media",
     "description": "Social media marketing materials, templates, and guides",
     "parentFolder": "67f5a8b2c3d4e5f6g7h8i9j1",
     "icon": "users",
     "color": "#6f42c1",
     "order": 1,
     "allowMaterials": true,
     "isProtected": true
   }
   🔗 Parent Folder ID: 67f5a8b2c3d4e5f6g7h8i9j1
   User: John Doe (67f1a2b3c4d5e6f7g8h9i0j1)
   Time: 2024-01-15T10:15:00.000Z
   ℹ️  Grandchild folders can contain materials and cannot have subfolders

[GRANDCHILD-FOLDER-API] POST /api/folders/grandchild 201 45 ms - 1456 bytes User:67f1a2b3c4d5e6f7g8h9i0j1 {...}
```

### Response
```json
{
  "success": true,
  "message": "Grandchild folder created successfully (can now contain materials)",
  "data": {
    "_id": "67f5a8b2c3d4e5f6g7h8i9j3",
    "name": "Social Media",
    "slug": "social-media",
    "description": "Social media marketing materials, templates, and guides",
    "parentFolder": {
      "_id": "67f5a8b2c3d4e5f6g7h8i9j1",
      "name": "Digital Marketing",
      "slug": "digital-marketing",
      "fullPath": "Sales & Marketing/Digital Marketing",
      "level": 1
    },
    "level": 2,
    "fullPath": "Sales & Marketing/Digital Marketing/Social Media",
    "icon": "users",
    "color": "#6f42c1",
    "isActive": true,
    "order": 1,
    "materialCount": 0,
    "subfolderCount": 0,
    "totalSize": 0,
    "visibility": "public",
    "allowedRoles": [],
    "isProtected": true,
    "allowMaterials": true,
    "folderType": "grandchild",
    "canHaveSubfolders": false,
    "canHaveMaterials": true,
    "createdBy": {
      "_id": "67f1a2b3c4d5e6f7g8h9i0j1",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "createdAt": "2024-01-15T10:15:00.000Z",
    "updatedAt": "2024-01-15T10:15:00.000Z"
  }
}
```

### Key Differences from Generic Endpoint:
- ✅ **parentFolder field required** - Must be a Level 1 folder
- ✅ **Validates parent is actually a Level 1 folder**
- ✅ **Level automatically set to 2**
- ✅ **allowMaterials defaults to true** (can be overridden)
- ✅ **canHaveMaterials is true** - This is where materials go!
- ✅ **canHaveSubfolders is false** - Maximum depth reached
- ✅ **Clear success message indicates materials can be added**

---

## Error Handling Examples

### 1. Trying to Create Parent with parentFolder
```http
POST /api/folders/parent
{
  "name": "Test Parent",
  "parentFolder": "some_id"
}
```
**Response (400):**
```json
{
  "success": false,
  "message": "Validation errors",
  "errors": [
    {
      "field": "parentFolder",
      "message": "Parent folders cannot have a parent folder"
    }
  ]
}
```

### 2. Trying to Create Child without parentFolder
```http
POST /api/folders/child
{
  "name": "Test Child"
}
```
**Response (400):**
```json
{
  "success": false,
  "message": "Validation errors",
  "errors": [
    {
      "field": "parentFolder",
      "message": "Parent folder is required for child folders"
    }
  ]
}
```

### 3. Trying to Create Child under Grandchild Folder
```http
POST /api/folders/child
{
  "name": "Test Child",
  "parentFolder": "grandchild_folder_id"
}
```
**Response (400):**
```json
{
  "success": false,
  "message": "Child folders can only be created under parent folders (level 0)"
}
```

### 4. Trying to Create Grandchild under Parent (skipping child level)
```http
POST /api/folders/grandchild
{
  "name": "Test Grandchild",
  "parentFolder": "parent_folder_id"
}
```
**Response (400):**
```json
{
  "success": false,
  "message": "Grandchild folders can only be created under child folders (level 1)"
}
```

---

## Complete Example: Create Full Hierarchy

### Frontend JavaScript Example
```javascript
// 1. Create parent folder
const createParentFolder = async () => {
  const response = await fetch('/api/folders/parent', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Operations',
      description: 'Operational processes and procedures',
      icon: 'briefcase',
      color: '#28a745'
    })
  });
  
  const result = await response.json();
  console.log('Parent created:', result.data.folderType); // "parent"
  return result.data._id;
};

// 2. Create child folder
const createChildFolder = async (parentId) => {
  const response = await fetch('/api/folders/child', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'HR Processes',
      description: 'Human resources procedures and forms',
      parentFolder: parentId,
      icon: 'users',
      color: '#17a2b8'
    })
  });
  
  const result = await response.json();
  console.log('Child created:', result.data.folderType); // "child"
  console.log('Full path:', result.data.fullPath); // "Operations/HR Processes"
  return result.data._id;
};

// 3. Create grandchild folder (can hold materials)
const createGrandchildFolder = async (childId) => {
  const response = await fetch('/api/folders/grandchild', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      name: 'Onboarding',
      description: 'Employee onboarding materials and checklists',
      parentFolder: childId,
      icon: 'file-text',
      color: '#6f42c1',
      allowMaterials: true,
      isProtected: true
    })
  });
  
  const result = await response.json();
  console.log('Grandchild created:', result.data.folderType); // "grandchild"
  console.log('Can have materials:', result.data.canHaveMaterials); // true
  console.log('Full path:', result.data.fullPath); // "Operations/HR Processes/Onboarding"
  return result.data._id;
};

// 4. Upload material to grandchild folder
const uploadMaterial = async (grandchildId) => {
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  formData.append('title', 'New Employee Checklist');
  formData.append('folder', grandchildId);
  formData.append('materialType', 'checklist');
  
  const response = await fetch('/api/materials', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`
    },
    body: formData
  });
  
  const result = await response.json();
  console.log('Material uploaded to:', result.data.folder.fullPath);
};

// Execute the complete flow
const createCompleteHierarchy = async () => {
  try {
    const parentId = await createParentFolder();
    const childId = await createChildFolder(parentId);
    const grandchildId = await createGrandchildFolder(childId);
    await uploadMaterial(grandchildId);
    
    console.log('✅ Complete folder hierarchy created successfully!');
  } catch (error) {
    console.error('❌ Error creating hierarchy:', error);
  }
};
```

---

## Benefits of Separate Endpoints

### 1. **Clear Intent & Validation**
- Each endpoint has specific validation rules
- Prevents common mistakes (like adding parentFolder to parent folders)
- Clear error messages specific to each folder type

### 2. **Enhanced Development Experience**
- TypeScript interfaces can be specific to each folder type
- Better IDE autocompletion and validation
- Self-documenting API endpoints

### 3. **Improved Debugging**
- Enhanced Morgan logging identifies exact operation type
- Specific context information for each folder level
- Easy to trace issues in logs

### 4. **Frontend Simplicity**
```javascript
// Clear and intuitive
createParentFolder({ name: "Sales" })
createChildFolder({ name: "Digital", parentFolder: parentId })
createGrandchildFolder({ name: "Social Media", parentFolder: childId })

// vs generic (less clear)
createFolder({ name: "Sales" }) // What level is this?
createFolder({ name: "Digital", parentFolder: parentId }) // What level will this be?
```

### 5. **Better Error Prevention**
- Compile-time/development-time catching of hierarchy violations
- Specific validation messages guide developers
- Reduces trial-and-error during development

### 6. **Backward Compatibility**
- Original `/api/folders` endpoint still works
- Gradual migration path for existing code
- No breaking changes to existing implementations

---

## Migration Guide

### For Existing Code:
1. **Keep using** `/api/folders` - it still works exactly the same
2. **Gradually migrate** to specific endpoints for new features
3. **Use specific endpoints** for new folder creation UI components

### Recommended Migration:
```javascript
// Old way (still works)
fetch('/api/folders', { 
  body: JSON.stringify({ name: "Parent Folder" }) 
})

// New way (recommended)
fetch('/api/folders/parent', { 
  body: JSON.stringify({ name: "Parent Folder" }) 
})
```

The separate endpoints provide a clearer, more maintainable API while preserving full backward compatibility with existing implementations.