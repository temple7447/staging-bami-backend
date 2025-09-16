# Central Knowledge Library API

This document describes the API endpoints for the Central Knowledge Library feature integrated into the BamiHustle Portfolio Management System.

## Overview

The Knowledge Library provides a comprehensive system for managing and organizing materials across different categories, portfolios, and manager roles. It supports various file types and includes features like search, filtering, notes, highlights, and reviews.

## Authentication

All endpoints require authentication using JWT tokens. Include the token in the Authorization header:
```
Authorization: Bearer <your_jwt_token>
```

## Base URL

```
http://localhost:5000/api
```

---

## Categories API

### GET /categories
Get all categories with hierarchical structure.

**Query Parameters:**
- `flat` (boolean): Return flat list instead of hierarchical tree
- `parent` (string): Filter by parent category ID

**Response:**
```json
{
  "success": true,
  "count": 12,
  "data": [
    {
      "_id": "category_id",
      "name": "Sales",
      "slug": "sales",
      "description": "Sales-related materials",
      "icon": "trending-up",
      "color": "#28a745",
      "level": 0,
      "order": 1,
      "materialCount": 5,
      "subcategories": [],
      "createdAt": "2024-01-15T10:00:00.000Z"
    }
  ]
}
```

### POST /categories
Create a new category.

**Required Body:**
```json
{
  "name": "Marketing",
  "description": "Marketing materials and guides",
  "parentCategory": null,
  "color": "#17a2b8",
  "order": 2
}
```

**Response:**
```json
{
  "success": true,
  "message": "Category created successfully",
  "data": {
    "_id": "category_id",
    "name": "Marketing",
    "slug": "marketing",
    "description": "Marketing materials and guides",
    "parentCategory": null,
    "level": 0,
    "color": "#17a2b8",
    "order": 2,
    "materialCount": 0,
    "createdBy": {
      "_id": "user_id",
      "name": "Admin User",
      "email": "admin@example.com"
    }
  }
}
```

### GET /categories/:id
Get a single category by ID.

### PUT /categories/:id
Update a category.

### DELETE /categories/:id
Delete a category (soft delete).

### GET /categories/stats
Get category statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "totalCategories": 12,
    "totalMaterials": 45,
    "categories": [
      {
        "name": "Sales",
        "materialCount": 8,
        "totalViews": 150,
        "totalDownloads": 45
      }
    ]
  }
}
```

### PUT /categories/reorder
Reorder categories.

**Body:**
```json
{
  "categories": [
    { "id": "category_id_1" },
    { "id": "category_id_2" }
  ]
}
```

### POST /categories/init-defaults
Initialize default categories (Super Admin only).

---

## Materials API

### GET /materials
Get materials with search and filtering.

**Query Parameters:**
- `search` (string): Search term for title, description, tags, keywords
- `category` (string): Filter by category ID
- `materialType` (string): Filter by material type
- `relatedPortfolio` (string): Filter by portfolio
- `relatedManagerRole` (string): Filter by manager role
- `fileType` (string): Filter by file type
- `expectedROI` (string): Filter by ROI level (high, medium, low)
- `timeRequirement` (string): Filter by time requirement
- `tags` (string): Comma-separated list of tags
- `page` (number): Page number (default: 1)
- `limit` (number): Items per page (default: 20)
- `sortBy` (string): Sort field (default: createdAt)
- `sortOrder` (string): Sort order (asc, desc)

**Example:**
```
GET /materials?search=marketing&category=category_id&page=1&limit=10
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "_id": "material_id",
      "title": "Marketing Strategy Guide",
      "description": "Comprehensive marketing strategy document",
      "fileName": "uuid-filename.pdf",
      "originalFileName": "marketing-strategy.pdf",
      "fileSize": 2048576,
      "fileType": "pdf",
      "category": {
        "name": "Marketing",
        "slug": "marketing",
        "icon": "megaphone",
        "color": "#17a2b8"
      },
      "relatedPortfolio": "business",
      "relatedManagerRole": "marketing",
      "materialType": "guide",
      "expectedROI": "high",
      "timeRequirement": "medium",
      "tags": ["strategy", "marketing", "guide"],
      "viewCount": 25,
      "downloadCount": 8,
      "averageRating": 4.5,
      "ratingCount": 4,
      "createdAt": "2024-01-15T10:00:00.000Z"
    }
  ],
  "pagination": {
    "currentPage": 1,
    "totalPages": 3,
    "totalItems": 45,
    "itemsPerPage": 20
  }
}
```

### POST /materials
Upload a new material.

**Content-Type:** `multipart/form-data`

**Required Fields:**
- `file` (file): The file to upload
- `title` (string): Material title
- `category` (string): Category ID
- `relatedPortfolio` (string): Related portfolio
- `relatedManagerRole` (string): Related manager role
- `materialType` (string): Material type

**Optional Fields:**
- `description` (string): Material description
- `expectedROI` (string): Expected ROI level
- `timeRequirement` (string): Time requirement
- `tags` (string): Comma-separated tags
- `keywords` (string): Comma-separated keywords
- `pageCount` (number): Number of pages (for documents)
- `duration` (number): Duration in seconds (for audio/video)
- `visibility` (string): Visibility level
- `allowedRoles` (string): Comma-separated allowed roles
- `priority` (number): Priority level (0-10)

**Example using curl:**
```bash
curl -X POST \
  -H "Authorization: Bearer your_jwt_token" \
  -F "file=@/path/to/document.pdf" \
  -F "title=Marketing Strategy Guide" \
  -F "description=Comprehensive marketing strategy document" \
  -F "category=category_id" \
  -F "relatedPortfolio=business" \
  -F "relatedManagerRole=marketing" \
  -F "materialType=guide" \
  -F "expectedROI=high" \
  -F "tags=strategy,marketing,guide" \
  http://localhost:5000/api/materials
```

**Response:**
```json
{
  "success": true,
  "message": "Material uploaded successfully",
  "data": {
    "_id": "material_id",
    "title": "Marketing Strategy Guide",
    "fileName": "uuid-filename.pdf",
    "originalFileName": "marketing-strategy.pdf",
    "fileSize": 2048576,
    "fileType": "pdf",
    "mimeType": "application/pdf",
    "filePath": "/path/to/uploads/materials/uuid-filename.pdf",
    "fileUrl": "/api/materials/download/uuid-filename.pdf",
    "category": {
      "name": "Marketing",
      "slug": "marketing"
    },
    "createdBy": {
      "name": "Admin User",
      "email": "admin@example.com"
    }
  }
}
```

### GET /materials/:id
Get a single material by ID.

**Response includes:**
- Full material details
- Related materials
- User notes and highlights
- Reviews and ratings

### PUT /materials/:id
Update a material (metadata only, not the file).

### DELETE /materials/:id
Delete a material (soft delete).

### GET /materials/download/:filename
Download a material file.

**Response:**
- File stream with appropriate headers
- Tracks download count

### POST /materials/:id/notes
Add a note to a material.

**Body:**
```json
{
  "content": "This is a useful guide for our Q1 strategy."
}
```

### POST /materials/:id/highlights
Add a highlight to a material.

**Body:**
```json
{
  "text": "Important section about customer segmentation",
  "page": 5,
  "position": {
    "start": 120,
    "end": 180
  }
}
```

### POST /materials/:id/reviews
Add a review to a material.

**Body:**
```json
{
  "rating": 5,
  "comment": "Excellent guide, very comprehensive and actionable."
}
```

### GET /materials/stats
Get material statistics.

**Response:**
```json
{
  "success": true,
  "data": {
    "overview": {
      "totalMaterials": 45,
      "totalViews": 1250,
      "totalDownloads": 320,
      "avgRating": 4.2
    },
    "byType": [
      {
        "_id": "guide",
        "count": 15,
        "totalViews": 450,
        "totalDownloads": 120
      }
    ],
    "byPortfolio": [
      {
        "_id": "business",
        "count": 25,
        "totalViews": 750
      }
    ],
    "byRole": [
      {
        "_id": "marketing",
        "count": 12,
        "totalViews": 380
      }
    ]
  }
}
```

---

## Data Models

### Category
```json
{
  "name": "string (required, 2-100 chars)",
  "slug": "string (auto-generated)",
  "description": "string (optional, max 500 chars)",
  "parentCategory": "ObjectId (optional)",
  "level": "number (auto-calculated)",
  "icon": "string (default: 'folder')",
  "color": "string (hex color, default: '#007bff')",
  "isActive": "boolean (default: true)",
  "order": "number (default: 0)",
  "materialCount": "number (auto-updated)",
  "createdBy": "ObjectId (required)",
  "updatedBy": "ObjectId (optional)"
}
```

### Material
```json
{
  "title": "string (required, 2-200 chars)",
  "description": "string (optional, max 1000 chars)",
  "slug": "string (auto-generated)",
  "fileName": "string (required)",
  "originalFileName": "string (required)",
  "fileSize": "number (required)",
  "fileType": "string (required, enum)",
  "mimeType": "string (required)",
  "filePath": "string (required)",
  "fileUrl": "string (optional)",
  "category": "ObjectId (required)",
  "relatedPortfolio": "string (required, enum)",
  "relatedManagerRole": "string (required, enum)",
  "materialType": "string (required, enum)",
  "expectedROI": "string (enum: high, medium, low)",
  "timeRequirement": "string (enum: quick, medium, deep_study)",
  "tags": "array of strings",
  "keywords": "array of strings",
  "pageCount": "number (optional)",
  "duration": "number (optional, in seconds)",
  "visibility": "string (enum: public, managers_only, owner_only, role_specific)",
  "allowedRoles": "array of strings",
  "viewCount": "number (default: 0)",
  "downloadCount": "number (default: 0)",
  "lastAccessed": "Date",
  "version": "string (default: '1.0')",
  "status": "string (enum: active, archived, pending_review, under_revision)",
  "isActive": "boolean (default: true)",
  "isFeatured": "boolean (default: false)",
  "priority": "number (0-10, default: 0)",
  "averageRating": "number (0-5, default: 0)",
  "ratingCount": "number (default: 0)",
  "notes": "array of note objects",
  "highlights": "array of highlight objects",
  "reviews": "array of review objects",
  "createdBy": "ObjectId (required)",
  "updatedBy": "ObjectId (optional)"
}
```

---

## Supported File Types

### Documents
- PDF (.pdf)
- Microsoft Word (.doc, .docx)
- Text files (.txt)

### Spreadsheets
- Microsoft Excel (.xls, .xlsx)

### Presentations
- Microsoft PowerPoint (.ppt, .pptx)

### Media
- Audio: MP3 (.mp3), WAV (.wav)
- Video: MP4 (.mp4), QuickTime (.mov), AVI (.avi)
- Images: JPEG (.jpg, .jpeg), PNG (.png), GIF (.gif)

### Archives
- ZIP (.zip)
- RAR (.rar)

**File Size Limit:** 100MB per file

---

## Enums

### Related Portfolio
- `personal`
- `business`
- `estate`
- `equipment`
- `investments`
- `other`

### Related Manager Role
- `operations`
- `marketing`
- `sales`
- `delivery`
- `finance`
- `fundraising`
- `legal`
- `automation`
- `hr`
- `leadership`

### Material Type
- `guide`
- `case_study`
- `how_to`
- `template`
- `checklist`
- `presentation`
- `video_tutorial`
- `audio_note`
- `document`
- `image`
- `other`

### Expected ROI
- `high`
- `medium`
- `low`

### Time Requirement
- `quick`
- `medium`
- `deep_study`

### Visibility
- `public`
- `managers_only`
- `owner_only`
- `role_specific`

### Status
- `active`
- `archived`
- `pending_review`
- `under_revision`

---

## Error Responses

All error responses follow this format:
```json
{
  "success": false,
  "message": "Error message",
  "errors": [
    {
      "field": "fieldName",
      "message": "Field-specific error message"
    }
  ]
}
```

**Common HTTP Status Codes:**
- `400` - Bad Request (validation errors)
- `401` - Unauthorized (authentication required)
- `403` - Forbidden (insufficient permissions)
- `404` - Not Found
- `413` - Payload Too Large (file too big)
- `415` - Unsupported Media Type (invalid file type)
- `500` - Internal Server Error

---

## Usage Examples

### Initialize Default Categories
```javascript
// First-time setup - create default categories
const response = await fetch('/api/categories/init-defaults', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  }
});
```

### Create a Custom Category
```javascript
const categoryData = {
  name: 'Custom Training',
  description: 'Custom training materials for staff',
  parentCategory: null,
  color: '#ff6b6b'
};

const response = await fetch('/api/categories', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify(categoryData)
});
```

### Upload a Material
```javascript
const formData = new FormData();
formData.append('file', fileInput.files[0]);
formData.append('title', 'Employee Handbook');
formData.append('description', 'Complete employee handbook for 2024');
formData.append('category', 'hr_category_id');
formData.append('relatedPortfolio', 'business');
formData.append('relatedManagerRole', 'hr');
formData.append('materialType', 'guide');
formData.append('expectedROI', 'high');
formData.append('tags', 'hr,handbook,employees,policies');

const response = await fetch('/api/materials', {
  method: 'POST',
  headers: {
    'Authorization': `Bearer ${token}`
  },
  body: formData
});
```

### Search Materials
```javascript
const searchParams = new URLSearchParams({
  search: 'marketing strategy',
  category: 'marketing_category_id',
  materialType: 'guide',
  expectedROI: 'high',
  page: 1,
  limit: 10
});

const response = await fetch(`/api/materials?${searchParams}`, {
  headers: {
    'Authorization': `Bearer ${token}`
  }
});
```

This API provides a comprehensive knowledge management system that integrates seamlessly with your Portfolio Management System, allowing for efficient organization and retrieval of materials across all business functions.