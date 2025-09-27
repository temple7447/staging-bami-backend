# Enhanced Morgan Logging Setup

This document explains the enhanced Morgan logging configuration in your BamiHustle backend.

## Features

### 🎨 Color-Coded API Identification
- `[FOLDER-API]` - Cyan color for folder operations
- `[MATERIAL-API]` - Yellow color for material operations  
- `[AUTH-API]` - Green color for authentication operations

### 📝 Detailed Request Logging
For each API request, you'll see:
- **Method**: HTTP method (GET, POST, PUT, DELETE)
- **Path**: Full request URL with query parameters
- **Query**: JSON representation of query parameters
- **Body**: Request body (truncated for large payloads, hidden for file uploads)
- **User**: Authentication status and user info
- **Timestamp**: ISO timestamp of the request

### 📤 Response Logging
For each API response, you'll see:
- **Status Code**: HTTP status code
- **Success**: Boolean success indicator
- **Message**: Response message
- **Data Summary**: Summary of response data
  - Array responses: Item count and first item details
  - Object responses: ID, name, and special folder properties
- **Errors**: Validation or other errors
- **Timestamp**: ISO timestamp of the response

### 🗂️ Special Folder Logging
For folder operations, additional information is logged:
- **Folder Type**: parent, child, or grandchild
- **Full Path**: Complete hierarchy path
- **Level**: Folder level (0, 1, or 2)

## Environment Configuration

### Development Mode (Enhanced Logging)
Set in your `.env` file:
```bash
NODE_ENV=development
```

**Features enabled:**
- ✅ Color-coded endpoint identification
- ✅ Detailed request/response logging with emojis
- ✅ User authentication tracking
- ✅ Request/response body logging
- ✅ Special folder operation details
- ✅ Response data summaries
- ✅ Visual separators between requests

**Example output:**
```
🗂️  FOLDER OPERATION:
   Method: POST
   Path: /api/folders
   Query: {}
   Body: {
     "name": "Digital Marketing",
     "description": "Digital marketing resources",
     "parentFolder": "67f5a8b2c3d4e5f6g7h8i9j0"
   }
   User: John Doe (67f1a2b3c4d5e6f7g8h9i0j1)
   Time: 2024-01-15T10:05:00.000Z

[FOLDER-API] POST /api/folders 201 45 ms - 1247 bytes User:67f1a2b3c4d5e6f7g8h9i0j1 {"name":"Digital Marketing","description":"Digital marketing resources","parentFolder":"67f5a8b2c3d4e5f6g7h8i9j0"}

📤 RESPONSE for POST /api/folders:
   Status: 201
   Success: true
   Message: Folder created successfully
   Data ID: 67f5a8b2c3d4e5f6g7h8i9j1
   Data name: Digital Marketing
   Folder Type: child
   Full Path: Sales & Marketing/Digital Marketing
   Level: 1
   Time: 2024-01-15T10:05:00.123Z
────────────────────────────────────────────────────────────────────────────────
```

### Production Mode (Standard Logging)
Set in your `.env` file:
```bash
NODE_ENV=production
```

Uses Morgan's standard 'combined' format for production deployments.

## Usage

### 1. Set Environment
Copy the example environment file:
```bash
cp .env.example .env
```

Edit `.env` and set:
```bash
NODE_ENV=development
```

### 2. Start Server
```bash
npm run dev
# or
npm start
```

You should see the startup banner with endpoint information.

### 3. Test Logging
Run the test script to see logging in action:
```bash
node test-logging.js
```

Or make manual API calls:
```bash
# Test folder endpoints
curl http://localhost:5000/api/folders
curl http://localhost:5000/api/folders/stats
curl http://localhost:5000/api/folders/for-materials

# Test with POST (will fail auth but show logging)
curl -X POST http://localhost:5000/api/folders \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Folder","description":"Test description"}'
```

## Log Examples

### Successful Folder Creation
```
🗂️  FOLDER OPERATION:
   Method: POST
   Path: /api/folders
   Query: {}
   Body: {
     "name": "Social Media",
     "parentFolder": "67f5a8b2c3d4e5f6g7h8i9j1"
   }
   User: John Doe (67f1a2b3c4d5e6f7g8h9i0j1)
   Time: 2024-01-15T10:15:00.000Z

📤 RESPONSE for POST /api/folders:
   Status: 201
   Success: true
   Message: Folder created successfully
   Folder Type: grandchild
   Full Path: Sales & Marketing/Digital Marketing/Social Media
   Level: 2
```

### Authentication Error
```
🗂️  FOLDER OPERATION:
   Method: POST
   Path: /api/folders
   Body: {"name":"Test Folder"}
   User: Not authenticated yet

📤 RESPONSE for POST /api/folders:
   Status: 401
   Success: false
   Message: Access denied. No token provided
```

### Get Folder Tree
```
🗂️  FOLDER OPERATION:
   Method: GET
   Path: /api/folders?view=tree
   Query: {"view":"tree"}
   User: John Doe (67f1a2b3c4d5e6f7g8h9i0j1)

📤 RESPONSE for GET /api/folders:
   Status: 200
   Success: true
   Data: Array with 1 items
   First item ID: 67f5a8b2c3d4e5f6g7h8i9j0
   First item name: Sales & Marketing
```

## Benefits

1. **Debugging**: Easy to trace request/response flows
2. **Development**: Clear visibility into API usage patterns
3. **Performance**: Response time tracking for optimization
4. **Security**: Authentication status monitoring
5. **Data Flow**: Understanding folder hierarchy operations
6. **Error Tracking**: Clear error identification and logging

## Customization

You can modify the logging behavior in `server.js`:

- **Skip certain endpoints**: Modify the `skip` function in Morgan configuration
- **Add custom tokens**: Create new Morgan tokens for additional data
- **Change colors**: Modify the ANSI color codes in the format string
- **Adjust verbosity**: Comment out specific logging middleware

The logging system is designed to be helpful during development while remaining performant in production.