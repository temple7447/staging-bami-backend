# Complete Folder Hierarchy Creation Process

This document demonstrates the complete request/response flow for creating a 3-level folder hierarchy (Parent → Child → Grandchild) in the BamiHustle Knowledge Library system.

## Overview

The system supports a Google Drive-style folder hierarchy with exactly 3 levels:
- **Level 0 (Parent)**: Top-level organizational containers
- **Level 1 (Child)**: Sub-categories within parent folders
- **Level 2 (Grandchild)**: Final level where materials are stored

## Authentication

All requests require JWT authentication:
```http
Authorization: Bearer <your_jwt_token>
```

---

## Step 1: Create Parent Folder (Level 0)

### Request
```http
POST /api/folders
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "name": "Sales & Marketing",
  "description": "All sales and marketing related materials and resources",
  "icon": "megaphone",
  "color": "#28a745",
  "order": 1,
  "visibility": "public",
  "allowedRoles": [],
  "isProtected": false
}
```

### Response
```json
{
  "success": true,
  "message": "Folder created successfully",
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
    "allowMaterials": true,
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

### Key Points
- **Level 0**: Parent folder at root level
- **parentFolder**: `null` (root level)
- **fullPath**: Just the folder name
- **canHaveSubfolders**: `true` (can contain child folders)
- **canHaveMaterials**: `false` (materials only go in grandchild folders)
- **folderType**: `"parent"`

---

## Step 2: Create Child Folder (Level 1)

### Request
```http
POST /api/folders
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

### Response
```json
{
  "success": true,
  "message": "Folder created successfully",
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
    "allowMaterials": true,
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

### Key Points
- **Level 1**: Child folder under parent
- **parentFolder**: References the parent folder ID
- **fullPath**: `"Sales & Marketing/Digital Marketing"` (auto-generated)
- **canHaveSubfolders**: `true` (can contain grandchild folders)
- **canHaveMaterials**: `false` (materials only in grandchild folders)
- **folderType**: `"child"`

---

## Step 3: Create Another Child Folder (Level 1)

### Request
```http
POST /api/folders
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "name": "Sales Strategy",
  "description": "Sales methodologies, processes, and strategic materials",
  "parentFolder": "67f5a8b2c3d4e5f6g7h8i9j0",
  "icon": "target",
  "color": "#dc3545",
  "order": 2,
  "visibility": "managers_only",
  "isProtected": true
}
```

### Response
```json
{
  "success": true,
  "message": "Folder created successfully",
  "data": {
    "_id": "67f5a8b2c3d4e5f6g7h8i9j2",
    "name": "Sales Strategy",
    "slug": "sales-strategy",
    "description": "Sales methodologies, processes, and strategic materials",
    "parentFolder": {
      "_id": "67f5a8b2c3d4e5f6g7h8i9j0",
      "name": "Sales & Marketing",
      "slug": "sales-marketing",
      "fullPath": "Sales & Marketing",
      "level": 0
    },
    "level": 1,
    "fullPath": "Sales & Marketing/Sales Strategy",
    "icon": "target",
    "color": "#dc3545",
    "isActive": true,
    "order": 2,
    "materialCount": 0,
    "subfolderCount": 0,
    "totalSize": 0,
    "visibility": "managers_only",
    "allowedRoles": [],
    "isProtected": true,
    "allowMaterials": true,
    "folderType": "child",
    "canHaveSubfolders": true,
    "canHaveMaterials": false,
    "createdBy": {
      "_id": "67f1a2b3c4d5e6f7g8h9i0j1",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "createdAt": "2024-01-15T10:10:00.000Z",
    "updatedAt": "2024-01-15T10:10:00.000Z"
  }
}
```

---

## Step 4: Create Grandchild Folders (Level 2) - These Can Hold Materials

### Request 1: Social Media Folder
```http
POST /api/folders
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

### Response 1
```json
{
  "success": true,
  "message": "Folder created successfully",
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

### Request 2: Email Marketing Folder
```http
POST /api/folders
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "name": "Email Marketing",
  "description": "Email templates, campaigns, and automation workflows",
  "parentFolder": "67f5a8b2c3d4e5f6g7h8i9j1",
  "icon": "mail",
  "color": "#fd7e14",
  "order": 2,
  "allowMaterials": true,
  "isProtected": false
}
```

### Response 2
```json
{
  "success": true,
  "message": "Folder created successfully",
  "data": {
    "_id": "67f5a8b2c3d4e5f6g7h8i9j4",
    "name": "Email Marketing",
    "slug": "email-marketing",
    "description": "Email templates, campaigns, and automation workflows",
    "parentFolder": {
      "_id": "67f5a8b2c3d4e5f6g7h8i9j1",
      "name": "Digital Marketing",
      "slug": "digital-marketing",
      "fullPath": "Sales & Marketing/Digital Marketing",
      "level": 1
    },
    "level": 2,
    "fullPath": "Sales & Marketing/Digital Marketing/Email Marketing",
    "icon": "mail",
    "color": "#fd7e14",
    "isActive": true,
    "order": 2,
    "materialCount": 0,
    "subfolderCount": 0,
    "totalSize": 0,
    "visibility": "public",
    "allowedRoles": [],
    "isProtected": false,
    "allowMaterials": true,
    "folderType": "grandchild",
    "canHaveSubfolders": false,
    "canHaveMaterials": true,
    "createdBy": {
      "_id": "67f1a2b3c4d5e6f7g8h9i0j1",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "createdAt": "2024-01-15T10:20:00.000Z",
    "updatedAt": "2024-01-15T10:20:00.000Z"
  }
}
```

### Request 3: Sales Processes Folder (under Sales Strategy)
```http
POST /api/folders
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "name": "Sales Processes",
  "description": "Standard operating procedures, playbooks, and process documentation",
  "parentFolder": "67f5a8b2c3d4e5f6g7h8i9j2",
  "icon": "book",
  "color": "#20c997",
  "order": 1,
  "allowMaterials": true,
  "visibility": "role_specific",
  "allowedRoles": ["sales", "leadership"],
  "isProtected": true
}
```

### Response 3
```json
{
  "success": true,
  "message": "Folder created successfully",
  "data": {
    "_id": "67f5a8b2c3d4e5f6g7h8i9j5",
    "name": "Sales Processes",
    "slug": "sales-processes",
    "description": "Standard operating procedures, playbooks, and process documentation",
    "parentFolder": {
      "_id": "67f5a8b2c3d4e5f6g7h8i9j2",
      "name": "Sales Strategy",
      "slug": "sales-strategy",
      "fullPath": "Sales & Marketing/Sales Strategy",
      "level": 1
    },
    "level": 2,
    "fullPath": "Sales & Marketing/Sales Strategy/Sales Processes",
    "icon": "book",
    "color": "#20c997",
    "isActive": true,
    "order": 1,
    "materialCount": 0,
    "subfolderCount": 0,
    "totalSize": 0,
    "visibility": "role_specific",
    "allowedRoles": ["sales", "leadership"],
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
    "createdAt": "2024-01-15T10:25:00.000Z",
    "updatedAt": "2024-01-15T10:25:00.000Z"
  }
}
```

### Key Points for Grandchild Folders (Level 2)
- **Level 2**: Final level in the hierarchy
- **canHaveSubfolders**: `false` (maximum depth reached)
- **canHaveMaterials**: `true` (this is where materials are stored)
- **folderType**: `"grandchild"`
- **fullPath**: Complete hierarchy path (e.g., "Sales & Marketing/Digital Marketing/Social Media")

---

## Step 5: Attempt to Create Level 3 Folder (Should Fail)

### Request
```http
POST /api/folders
Content-Type: application/json
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

{
  "name": "Instagram Content",
  "description": "Instagram-specific content and templates",
  "parentFolder": "67f5a8b2c3d4e5f6g7h8i9j3"
}
```

### Response (Error)
```json
{
  "success": false,
  "message": "Cannot create folder: Maximum hierarchy depth of 3 levels exceeded (parent → child → grandchild)",
  "errors": [
    {
      "field": "parentFolder",
      "message": "Parent folder cannot contain subfolders (maximum depth reached)"
    }
  ]
}
```

---

## Step 6: View Complete Folder Hierarchy

### Request
```http
GET /api/folders
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Response
```json
{
  "success": true,
  "count": 1,
  "data": [
    {
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
      "subfolderCount": 2,
      "totalSize": 0,
      "visibility": "public",
      "allowedRoles": [],
      "isProtected": false,
      "allowMaterials": true,
      "folderType": "parent",
      "canHaveSubfolders": true,
      "canHaveMaterials": false,
      "depth": 0,
      "subfolders": [
        {
          "_id": "67f5a8b2c3d4e5f6g7h8i9j1",
          "name": "Digital Marketing",
          "slug": "digital-marketing",
          "description": "Digital marketing strategies, campaigns, and resources",
          "level": 1,
          "fullPath": "Sales & Marketing/Digital Marketing",
          "icon": "monitor",
          "color": "#17a2b8",
          "isActive": true,
          "order": 1,
          "subfolderCount": 2,
          "folderType": "child",
          "canHaveSubfolders": true,
          "canHaveMaterials": false,
          "depth": 1,
          "subfolders": [
            {
              "_id": "67f5a8b2c3d4e5f6g7h8i9j3",
              "name": "Social Media",
              "slug": "social-media",
              "level": 2,
              "fullPath": "Sales & Marketing/Digital Marketing/Social Media",
              "icon": "users",
              "color": "#6f42c1",
              "isActive": true,
              "order": 1,
              "folderType": "grandchild",
              "canHaveSubfolders": false,
              "canHaveMaterials": true,
              "depth": 2,
              "subfolders": []
            },
            {
              "_id": "67f5a8b2c3d4e5f6g7h8i9j4",
              "name": "Email Marketing",
              "slug": "email-marketing",
              "level": 2,
              "fullPath": "Sales & Marketing/Digital Marketing/Email Marketing",
              "icon": "mail",
              "color": "#fd7e14",
              "isActive": true,
              "order": 2,
              "folderType": "grandchild",
              "canHaveSubfolders": false,
              "canHaveMaterials": true,
              "depth": 2,
              "subfolders": []
            }
          ]
        },
        {
          "_id": "67f5a8b2c3d4e5f6g7h8i9j2",
          "name": "Sales Strategy",
          "slug": "sales-strategy",
          "description": "Sales methodologies, processes, and strategic materials",
          "level": 1,
          "fullPath": "Sales & Marketing/Sales Strategy",
          "icon": "target",
          "color": "#dc3545",
          "isActive": true,
          "order": 2,
          "subfolderCount": 1,
          "folderType": "child",
          "canHaveSubfolders": true,
          "canHaveMaterials": false,
          "depth": 1,
          "subfolders": [
            {
              "_id": "67f5a8b2c3d4e5f6g7h8i9j5",
              "name": "Sales Processes",
              "slug": "sales-processes",
              "level": 2,
              "fullPath": "Sales & Marketing/Sales Strategy/Sales Processes",
              "icon": "book",
              "color": "#20c997",
              "isActive": true,
              "order": 1,
              "folderType": "grandchild",
              "canHaveSubfolders": false,
              "canHaveMaterials": true,
              "depth": 2,
              "subfolders": []
            }
          ]
        }
      ],
      "createdAt": "2024-01-15T10:00:00.000Z",
      "updatedAt": "2024-01-15T10:00:00.000Z"
    }
  ],
  "view": "tree"
}
```

---

## Step 7: Get Folders Available for Materials

### Request
```http
GET /api/folders/for-materials
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Response
```json
{
  "success": true,
  "count": 3,
  "data": [
    {
      "_id": "67f5a8b2c3d4e5f6g7h8i9j4",
      "name": "Email Marketing",
      "fullPath": "Sales & Marketing/Digital Marketing/Email Marketing",
      "displayName": "Sales & Marketing/Digital Marketing/Email Marketing",
      "level": 2,
      "materialCount": 0,
      "color": "#fd7e14",
      "icon": "mail"
    },
    {
      "_id": "67f5a8b2c3d4e5f6g7h8i9j5",
      "name": "Sales Processes",
      "fullPath": "Sales & Marketing/Sales Strategy/Sales Processes",
      "displayName": "Sales & Marketing/Sales Strategy/Sales Processes",
      "level": 2,
      "materialCount": 0,
      "color": "#20c997",
      "icon": "book"
    },
    {
      "_id": "67f5a8b2c3d4e5f6g7h8i9j3",
      "name": "Social Media",
      "fullPath": "Sales & Marketing/Digital Marketing/Social Media",
      "displayName": "Sales & Marketing/Digital Marketing/Social Media",
      "level": 2,
      "materialCount": 0,
      "color": "#6f42c1",
      "icon": "users"
    }
  ]
}
```

---

## Step 8: Upload Material to Grandchild Folder

### Request
```http
POST /api/materials
Content-Type: multipart/form-data
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...

Form Data:
- file: [PDF file: social-media-strategy.pdf]
- title: Social Media Strategy 2024
- description: Comprehensive social media strategy and implementation guide
- folder: 67f5a8b2c3d4e5f6g7h8i9j3
- materialType: guide
- relatedPortfolio: business
- relatedManagerRole: marketing
- tags: social-media,strategy,marketing,2024
```

### Response
```json
{
  "success": true,
  "message": "Material uploaded successfully",
  "data": {
    "_id": "67f5a8b2c3d4e5f6g7h8i9j6",
    "title": "Social Media Strategy 2024",
    "slug": "social-media-strategy-2024",
    "description": "Comprehensive social media strategy and implementation guide",
    "folder": {
      "_id": "67f5a8b2c3d4e5f6g7h8i9j3",
      "name": "Social Media",
      "fullPath": "Sales & Marketing/Digital Marketing/Social Media",
      "level": 2
    },
    "fileUrl": "https://res.cloudinary.com/yourcloud/raw/upload/v1642248000/materials/social-media-strategy.pdf",
    "fileName": "social-media-strategy.pdf",
    "fileType": "pdf",
    "fileSize": 2048576,
    "materialType": "guide",
    "relatedPortfolio": "business",
    "relatedManagerRole": "marketing",
    "tags": ["social-media", "strategy", "marketing", "2024"],
    "status": "active",
    "isActive": true,
    "viewCount": 0,
    "downloadCount": 0,
    "uploadedBy": {
      "_id": "67f1a2b3c4d5e6f7g8h9i0j1",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

---

## Step 9: Get Single Folder with Materials

### Request
```http
GET /api/folders/67f5a8b2c3d4e5f6g7h8i9j3?includeMaterials=true&includeStats=true
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Response
```json
{
  "success": true,
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
    "materialCount": 1,
    "subfolderCount": 0,
    "totalSize": 2048576,
    "visibility": "public",
    "allowedRoles": [],
    "isProtected": true,
    "allowMaterials": true,
    "folderType": "grandchild",
    "canHaveSubfolders": false,
    "canHaveMaterials": true,
    "folderPath": [
      {
        "_id": "67f5a8b2c3d4e5f6g7h8i9j0",
        "name": "Sales & Marketing",
        "slug": "sales-marketing",
        "level": 0
      },
      {
        "_id": "67f5a8b2c3d4e5f6g7h8i9j1",
        "name": "Digital Marketing",
        "slug": "digital-marketing",
        "level": 1
      },
      {
        "_id": "67f5a8b2c3d4e5f6g7h8i9j3",
        "name": "Social Media",
        "slug": "social-media",
        "level": 2
      }
    ],
    "subfolders": [],
    "materials": [
      {
        "_id": "67f5a8b2c3d4e5f6g7h8i9j6",
        "title": "Social Media Strategy 2024",
        "slug": "social-media-strategy-2024",
        "fileType": "pdf",
        "fileSize": 2048576,
        "viewCount": 0,
        "downloadCount": 0,
        "createdAt": "2024-01-15T10:30:00.000Z"
      }
    ],
    "createdBy": {
      "_id": "67f1a2b3c4d5e6f7g8h9i0j1",
      "name": "John Doe",
      "email": "john@example.com"
    },
    "createdAt": "2024-01-15T10:15:00.000Z",
    "updatedAt": "2024-01-15T10:30:00.000Z"
  }
}
```

---

## Step 10: Get Folder Statistics

### Request
```http
GET /api/folders/stats
Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

### Response
```json
{
  "success": true,
  "data": {
    "overview": {
      "totalFolders": 6,
      "totalMaterials": 1,
      "parentFolders": 1,
      "childFolders": 2,
      "grandchildFolders": 3
    },
    "levelDistribution": [
      { "_id": 0, "count": 1 },
      { "_id": 1, "count": 2 },
      { "_id": 2, "count": 3 }
    ],
    "topFolders": [
      {
        "name": "Social Media",
        "fullPath": "Sales & Marketing/Digital Marketing/Social Media",
        "materialCount": 1,
        "totalSize": 2048576
      },
      {
        "name": "Email Marketing",
        "fullPath": "Sales & Marketing/Digital Marketing/Email Marketing",
        "materialCount": 0,
        "totalSize": 0
      },
      {
        "name": "Sales Processes",
        "fullPath": "Sales & Marketing/Sales Strategy/Sales Processes",
        "materialCount": 0,
        "totalSize": 0
      }
    ]
  }
}
```

---

## Summary

This example demonstrates the complete folder hierarchy creation process:

1. **Parent Folder (Level 0)**: Created at root level, can contain child folders but not materials
2. **Child Folders (Level 1)**: Created under parent folders, can contain grandchild folders but not materials
3. **Grandchild Folders (Level 2)**: Final level, can contain materials but no further subfolders

### Key Hierarchy Rules:
- **Maximum 3 levels**: Parent → Child → Grandchild (levels 0, 1, 2)
- **Materials only in grandchild folders**: Level 2 folders with `allowMaterials: true`
- **Automatic path generation**: `fullPath` is auto-generated based on hierarchy
- **Folder type identification**: Virtual `folderType` field indicates level purpose
- **Capability flags**: `canHaveSubfolders` and `canHaveMaterials` based on level
- **Protection and validation**: Prevents circular references and depth violations

### Frontend Implementation Tips:
1. Use `/api/folders/for-materials` to populate material upload dropdowns
2. Display breadcrumbs using the `folderPath` array
3. Show folder hierarchy using the tree structure from `/api/folders`
4. Respect `canHaveSubfolders` and `canHaveMaterials` for UI controls
5. Use `folderType` for visual styling and permissions