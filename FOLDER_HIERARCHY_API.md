# Folder Hierarchy API - Google Drive Style

This document describes the new hierarchical folder system for the BamiHustle Knowledge Library, designed to work like Google Drive with a maximum of 3 levels: Parent → Child → Grandchild.

## Overview

The folder system provides a structured, hierarchical organization for materials similar to Google Drive:

- **Parent Folders** (Level 0): Top-level organizational containers (e.g., "Sales", "Marketing")
- **Child Folders** (Level 1): Sub-categories within parent folders (e.g., "Sales/Digital Marketing")  
- **Grandchild Folders** (Level 2): Final level where materials are stored (e.g., "Sales/Digital Marketing/Social Media")

**Key Rules:**
- Maximum 3 levels of hierarchy (0, 1, 2)
- Materials can only be placed in grandchild folders (level 2)
- Parent and child folders organize structure but don't directly contain materials
- Folders cannot be deleted if they contain subfolders or materials (with protection)

---

## Base URL

```
http://localhost:5000/api/folders
```

---

## Authentication

All endpoints require authentication using JWT tokens:
```
Authorization: Bearer <your_jwt_token>
```

---

## Endpoints

### 1. Get All Folders

```http
GET /api/folders
```

Returns the complete folder hierarchy or filtered results based on query parameters.

**Query Parameters:**
- `view` - Display format: `tree` (default), `flat`, `dropdown`
- `parent` - Filter by parent folder ID (`null` for root folders)
- `level` - Filter by specific level (0, 1, or 2)
- `includeStats` - Include material statistics (`true`/`false`)

**Examples:**

```bash
# Get hierarchical tree (default)
GET /api/folders

# Get flat list for dropdowns
GET /api/folders?view=dropdown

# Get only parent folders (level 0)
GET /api/folders?level=0

# Get children of specific folder
GET /api/folders?parent=folder_id

# Include material statistics
GET /api/folders?includeStats=true
```

**Response:**
```json
{
  "success": true,
  "count": 5,
  "data": [
    {
      "_id": "folder_id_1",
      "name": "Sales",
      "level": 0,
      "folderType": "parent",
      "canHaveSubfolders": true,
      "canHaveMaterials": false,
      "subfolders": [
        {
          "_id": "folder_id_2",
          "name": "Digital Marketing",
          "level": 1,
          "folderType": "child",
          "canHaveSubfolders": true,
          "canHaveMaterials": false,
          "fullPath": "Sales/Digital Marketing",
          "subfolders": [
            {
              "_id": "folder_id_3",
              "name": "Social Media",
              "level": 2,
              "folderType": "grandchild",
              "canHaveSubfolders": false,
              "canHaveMaterials": true,
              "fullPath": "Sales/Digital Marketing/Social Media",
              "materialCount": 8,
              "totalSize": 2048576
            }
          ]
        }
      ]
    }
  ],
  "view": "tree"
}
```

### 2. Get Single Folder

```http
GET /api/folders/:id
```

**Query Parameters:**
- `includeStats` - Include material statistics
- `includeMaterials` - Include materials list (for grandchild folders only)

**Response:**
```json
{
  "success": true,
  "data": {
    "_id": "folder_id",
    "name": "Social Media",
    "description": "Social media marketing materials",
    "level": 2,
    "fullPath": "Sales/Digital Marketing/Social Media",
    "folderType": "grandchild",
    "canHaveSubfolders": false,
    "canHaveMaterials": true,
    "icon": "folder",
    "color": "#28a745",
    "materialCount": 8,
    "totalSize": 2048576,
    "folderPath": [
      { "_id": "parent_id", "name": "Sales", "level": 0 },
      { "_id": "child_id", "name": "Digital Marketing", "level": 1 },
      { "_id": "grandchild_id", "name": "Social Media", "level": 2 }
    ],
    "subfolders": [],
    "materials": [
      {
        "_id": "material_id",
        "title": "Instagram Strategy Guide",
        "fileType": "pdf",
        "fileSize": 1024000,
        "createdAt": "2024-01-15T10:00:00.000Z"
      }
    ]
  }
}
```

### 3. Create New Folder

```http
POST /api/folders
```

**Request Body:**
```json
{
  "name": "Social Media",
  "description": "Social media marketing materials and guides",
  "parentFolder": "parent_folder_id",
  "icon": "folder",
  "color": "#28a745",
  "order": 0,
  "visibility": "public",
  "allowedRoles": [],
  "allowMaterials": true,
  "isProtected": false
}
```

**Validation Rules:**
- `name` is required (2-100 characters)
- Parent folder must exist and be active
- Parent must be able to have subfolders (level < 2)
- Name must be unique within the same parent
- Maximum 3 levels of hierarchy enforced

**Response:**
```json
{
  "success": true,
  "message": "Folder created successfully",
  "data": {
    "_id": "new_folder_id",
    "name": "Social Media",
    "level": 2,
    "fullPath": "Sales/Digital Marketing/Social Media",
    "folderType": "grandchild",
    "canHaveSubfolders": false,
    "canHaveMaterials": true,
    "parentFolder": {
      "_id": "parent_id",
      "name": "Digital Marketing",
      "level": 1
    }
  }
}
```

### 4. Update Folder

```http
PUT /api/folders/:id
```

**Request Body:** (All fields optional)
```json
{
  "name": "Updated Name",
  "description": "Updated description",
  "parentFolder": "new_parent_id",
  "icon": "briefcase",
  "color": "#17a2b8",
  "order": 1,
  "visibility": "managers_only",
  "allowedRoles": ["marketing", "sales"],
  "isProtected": true
}
```

**Additional Validation:**
- Cannot create circular references
- Cannot exceed 3-level hierarchy limit
- Name must be unique in target location

### 5. Move Folder

```http
PUT /api/folders/:id/move
```

**Request Body:**
```json
{
  "targetParentId": "new_parent_folder_id"
}
```

**Validation:**
- Cannot move to itself or its descendants
- Target parent must support subfolders
- No name conflicts in target location
- Must respect hierarchy limits

### 6. Delete Folder

```http
DELETE /api/folders/:id
```

**Deletion Rules:**
- Cannot delete if contains subfolders
- Cannot delete protected folders with materials
- Soft delete (sets `isActive: false`)
- Updates parent subfolder counts

### 7. Get Folders for Materials

```http
GET /api/folders/for-materials
```

Returns only grandchild folders (level 2) that can contain materials.

**Response:**
```json
{
  "success": true,
  "count": 12,
  "data": [
    {
      "_id": "folder_id",
      "name": "Social Media",
      "fullPath": "Sales/Digital Marketing/Social Media",
      "displayName": "Sales/Digital Marketing/Social Media",
      "level": 2,
      "materialCount": 8,
      "color": "#28a745",
      "icon": "folder"
    }
  ]
}
```

### 8. Get Folder Statistics

```http
GET /api/folders/stats
```

**Response:**
```json
{
  "success": true,
  "data": {
    "overview": {
      "totalFolders": 45,
      "totalMaterials": 120,
      "parentFolders": 8,
      "childFolders": 15,
      "grandchildFolders": 22
    },
    "levelDistribution": [
      { "_id": 0, "count": 8 },
      { "_id": 1, "count": 15 },
      { "_id": 2, "count": 22 }
    ],
    "topFolders": [
      {
        "name": "Social Media",
        "fullPath": "Sales/Digital Marketing/Social Media",
        "materialCount": 15,
        "totalSize": 5242880
      }
    ]
  }
}
```

---

## Updated Materials API

The materials API now supports the new folder system while maintaining backward compatibility with categories.

### Upload Material to Folder

```http
POST /api/materials
```

**Form Data:**
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('title', 'Social Media Strategy Guide');
formData.append('folder', 'grandchild_folder_id'); // New folder field
formData.append('materialType', 'guide');
formData.append('relatedPortfolio', 'business');
formData.append('relatedManagerRole', 'marketing');
```

**Validation:**
- Either `folder` or `category` is required (folder takes precedence)
- Materials can only be uploaded to grandchild folders (level 2)
- Folder must have `allowMaterials: true`

### Get Materials by Folder

```http
GET /api/materials?folder=folder_id
```

**Backward Compatibility:**
```http
GET /api/materials?category=category_id  # Still works
```

---

## Data Models

### Folder Model

```json
{
  "name": "string (required, 2-100 chars)",
  "slug": "string (auto-generated)",
  "description": "string (optional, max 500 chars)",
  "parentFolder": "ObjectId (optional)",
  "level": "number (0-2, auto-calculated)",
  "fullPath": "string (auto-generated, e.g., 'Sales/Digital/Social')",
  "icon": "string (enum: folder, folder-open, briefcase, etc.)",
  "color": "string (hex color, default: #6C757D)",
  "isActive": "boolean (default: true)",
  "order": "number (for sorting, default: 0)",
  "materialCount": "number (auto-updated)",
  "subfolderCount": "number (auto-updated)",
  "totalSize": "number (total size of materials in bytes)",
  "visibility": "string (enum: public, managers_only, owner_only, role_specific)",
  "allowedRoles": "array of strings",
  "isProtected": "boolean (prevents deletion if contains materials)",
  "allowMaterials": "boolean (level 2 folders only)",
  "createdBy": "ObjectId (required)",
  "updatedBy": "ObjectId (optional)"
}
```

### Virtual Fields

- `folderType`: 'parent' | 'child' | 'grandchild'
- `canHaveSubfolders`: boolean (levels 0,1 only)
- `canHaveMaterials`: boolean (level 2 only)
- `breadcrumbs`: array of path components

---

## Usage Examples

### Create Complete Hierarchy

```javascript
// 1. Create parent folder
const parent = await fetch('/api/folders', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Marketing',
    description: 'All marketing related materials',
    icon: 'megaphone',
    color: '#17a2b8'
  })
});

// 2. Create child folder
const child = await fetch('/api/folders', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Digital Marketing',
    parentFolder: parent.data._id,
    icon: 'monitor',
    color: '#17a2b8'
  })
});

// 3. Create grandchild folder (can contain materials)
const grandchild = await fetch('/api/folders', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({
    name: 'Social Media',
    parentFolder: child.data._id,
    allowMaterials: true,
    isProtected: true
  })
});

// 4. Upload material to grandchild folder
const formData = new FormData();
formData.append('file', file);
formData.append('title', 'Instagram Strategy Guide');
formData.append('folder', grandchild.data._id);
formData.append('materialType', 'guide');

await fetch('/api/materials', {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${token}` },
  body: formData
});
```

### Navigate Folder Structure

```javascript
// Get folder tree
const folders = await fetch('/api/folders').then(r => r.json());

// Get specific folder with materials
const folder = await fetch(`/api/folders/${folderId}?includeMaterials=true`)
  .then(r => r.json());

// Get folders that can contain materials (for upload dropdown)
const materialFolders = await fetch('/api/folders/for-materials')
  .then(r => r.json());
```

### Search Materials in Folder Hierarchy

```javascript
// Search materials in specific folder
const materials = await fetch(`/api/materials?folder=${folderId}&search=strategy`)
  .then(r => r.json());

// Search materials in all subfolders of a parent
const parentMaterials = await fetch(`/api/materials?search=marketing`)
  .then(r => r.json());
```

---

## Migration from Categories

Use the provided migration script to convert existing categories to the new folder structure:

```bash
# Dry run to see what would happen
node scripts/migrateCategoriesToFolders.js --dry-run=true

# Run actual migration
node scripts/migrateCategoriesToFolders.js --dry-run=false

# Custom material folder name
node scripts/migrateCategoriesToFolders.js --material-folder-name="Files"
```

---

## Error Responses

```json
{
  "success": false,
  "message": "Cannot create folder: Maximum hierarchy depth of 3 levels exceeded",
  "errors": [
    {
      "field": "parentFolder",
      "message": "Parent folder cannot contain subfolders (maximum depth reached)"
    }
  ]
}
```

**Common Error Codes:**
- `400` - Validation errors, hierarchy violations
- `404` - Folder not found
- `409` - Name conflicts, circular references
- `422` - Business logic violations (e.g., materials in wrong level)

---

## Integration with Existing Frontend

### Folder Selector Component

```javascript
// Replace category selector with hierarchical folder selector
const FolderSelector = ({ onSelect, level }) => {
  const [folders, setFolders] = useState([]);
  
  useEffect(() => {
    // For material upload, only show grandchild folders
    const endpoint = level === 2 ? '/api/folders/for-materials' : '/api/folders?view=dropdown';
    fetch(endpoint).then(r => r.json()).then(data => setFolders(data.data));
  }, [level]);
  
  return (
    <select onChange={(e) => onSelect(e.target.value)}>
      <option value="">Select Folder...</option>
      {folders.map(folder => (
        <option key={folder._id} value={folder._id}>
          {folder.displayName || folder.fullPath}
        </option>
      ))}
    </select>
  );
};
```

### Breadcrumb Navigation

```javascript
const FolderBreadcrumb = ({ folderPath }) => (
  <nav className="breadcrumb">
    {folderPath.map((folder, index) => (
      <span key={folder._id}>
        <a href={`/folders/${folder._id}`}>{folder.name}</a>
        {index < folderPath.length - 1 && ' / '}
      </span>
    ))}
  </nav>
);
```

This new folder hierarchy system provides a much more intuitive and organized way to manage materials, similar to how users are accustomed to working with Google Drive or other file management systems.