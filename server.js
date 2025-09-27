const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const connectDatabase = require('./config/database');
const errorHandler = require('./middleware/error');

// Load env vars
dotenv.config();

// Connect to database
connectDatabase();

const app = express();

// Trust proxy
app.set('trust proxy', 1);

// Security middleware
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
    },
  },
}));

// Rate limiting
const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 minutes
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100, // limit each IP to 100 requests per windowMs
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true, // Return rate limit info in the `RateLimit-*` headers
  legacyHeaders: false, // Disable the `X-RateLimit-*` headers
});

// Apply rate limiting to all requests
app.use(limiter);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In development, allow all origins
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    
    // In production, specify allowed origins
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      "http://localhost:8080",
      "http://localhost:8081",
      'https://bami-hustle.vercel.app',
      'https://bumi-hustle.vercel.app',
      // Add your frontend URLs here
    ];
    
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
};

app.use(cors(corsOptions));

// Compression middleware
app.use(compression());

// Body parsing middleware
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Custom Morgan tokens for enhanced logging
morgan.token('body', (req) => {
  // Only log body for non-file uploads and limit size
  if (req.headers['content-type'] && req.headers['content-type'].includes('multipart/form-data')) {
    return '[FILE UPLOAD]';
  }
  
  if (req.body && Object.keys(req.body).length > 0) {
    const body = JSON.stringify(req.body);
    return body.length > 500 ? '[LARGE BODY]' : body;
  }
  return '';
});

morgan.token('user', (req) => {
  return req.user ? `User:${req.user.id}` : 'Guest';
});

morgan.token('folder-path', (req) => {
  if (req.originalUrl.includes('/api/folders/parent')) {
    return `[PARENT-FOLDER-API]`;
  }
  if (req.originalUrl.includes('/api/folders/child')) {
    return `[CHILD-FOLDER-API]`;
  }
  if (req.originalUrl.includes('/api/folders/grandchild')) {
    return `[GRANDCHILD-FOLDER-API]`;
  }
  if (req.originalUrl.includes('/api/folders')) {
    return `[FOLDER-API]`;
  }
  if (req.originalUrl.includes('/api/materials')) {
    return `[MATERIAL-API]`;
  }
  if (req.originalUrl.includes('/api/auth')) {
    return `[AUTH-API]`;
  }
  return '';
});

// Enhanced logging for development
if (process.env.NODE_ENV === 'development') {
  // Custom format with colors and detailed info
  app.use(morgan(
    '\x1b[36m:folder-path\x1b[0m \x1b[33m:method\x1b[0m \x1b[32m:url\x1b[0m \x1b[35m:status\x1b[0m :response-time ms - :res[content-length] bytes :user :body',
    {
      skip: (req, res) => {
        // Skip logging for health checks and static files
        return req.originalUrl === '/health' || req.originalUrl === '/';
      }
    }
  ));
  
  // Additional detailed logging for specific folder operations
  app.use('/api/folders/parent', (req, res, next) => {
    console.log(`\n💼 PARENT FOLDER OPERATION (Level 0):`);
    console.log(`   Method: ${req.method}`);
    console.log(`   Path: ${req.originalUrl}`);
    console.log(`   Query: ${JSON.stringify(req.query)}`);
    if (req.body && Object.keys(req.body).length > 0) {
      console.log(`   Body: ${JSON.stringify(req.body, null, 2)}`);
    }
    console.log(`   User: ${req.user ? req.user.name + ' (' + req.user.id + ')' : 'Not authenticated yet'}`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log(`   ℹ️  Parent folders are created at root level and can only contain child folders\n`);
    next();
  });
  
  app.use('/api/folders/child', (req, res, next) => {
    console.log(`\n📋 CHILD FOLDER OPERATION (Level 1):`);
    console.log(`   Method: ${req.method}`);
    console.log(`   Path: ${req.originalUrl}`);
    console.log(`   Query: ${JSON.stringify(req.query)}`);
    if (req.body && Object.keys(req.body).length > 0) {
      console.log(`   Body: ${JSON.stringify(req.body, null, 2)}`);
      if (req.body.parentFolder) {
        console.log(`   🔗 Parent Folder ID: ${req.body.parentFolder}`);
      }
    }
    console.log(`   User: ${req.user ? req.user.name + ' (' + req.user.id + ')' : 'Not authenticated yet'}`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log(`   ℹ️  Child folders must be created under parent folders (level 0)\n`);
    next();
  });
  
  app.use('/api/folders/grandchild', (req, res, next) => {
    console.log(`\n📁 GRANDCHILD FOLDER OPERATION (Level 2):`);
    console.log(`   Method: ${req.method}`);
    console.log(`   Path: ${req.originalUrl}`);
    console.log(`   Query: ${JSON.stringify(req.query)}`);
    if (req.body && Object.keys(req.body).length > 0) {
      console.log(`   Body: ${JSON.stringify(req.body, null, 2)}`);
      if (req.body.parentFolder) {
        console.log(`   🔗 Parent Folder ID: ${req.body.parentFolder}`);
      }
    }
    console.log(`   User: ${req.user ? req.user.name + ' (' + req.user.id + ')' : 'Not authenticated yet'}`);
    console.log(`   Time: ${new Date().toISOString()}`);
    console.log(`   ℹ️  Grandchild folders can contain materials and cannot have subfolders\n`);
    next();
  });
  
  // General folder operations logging
  app.use('/api/folders', (req, res, next) => {
    // Skip if already handled by specific folder type middleware
    if (req.originalUrl.includes('/parent') || req.originalUrl.includes('/child') || req.originalUrl.includes('/grandchild')) {
      return next();
    }
    
    console.log(`\n🗂️  FOLDER OPERATION:`);
    console.log(`   Method: ${req.method}`);
    console.log(`   Path: ${req.originalUrl}`);
    console.log(`   Query: ${JSON.stringify(req.query)}`);
    if (req.body && Object.keys(req.body).length > 0) {
      console.log(`   Body: ${JSON.stringify(req.body, null, 2)}`);
    }
    console.log(`   User: ${req.user ? req.user.name + ' (' + req.user.id + ')' : 'Not authenticated yet'}`);
    console.log(`   Time: ${new Date().toISOString()}\n`);
    next();
  });
  
  // Log material operations
  app.use('/api/materials', (req, res, next) => {
    console.log(`\n📄 MATERIAL OPERATION:`);
    console.log(`   Method: ${req.method}`);
    console.log(`   Path: ${req.originalUrl}`);
    console.log(`   Query: ${JSON.stringify(req.query)}`);
    if (req.method !== 'POST') { // Don't log body for file uploads
      console.log(`   Body: ${JSON.stringify(req.body, null, 2)}`);
    } else {
      console.log(`   Content-Type: ${req.headers['content-type'] || 'Not specified'}`);
    }
    console.log(`   User: ${req.user ? req.user.name + ' (' + req.user.id + ')' : 'Not authenticated yet'}`);
    console.log(`   Time: ${new Date().toISOString()}\n`);
    next();
  });
  
  // Response logging middleware for development
  app.use((req, res, next) => {
    const originalSend = res.send;
    
    res.send = function(data) {
      // Log response for API endpoints
      if (req.originalUrl.startsWith('/api/')) {
        console.log(`\n📤 RESPONSE for ${req.method} ${req.originalUrl}:`);
        console.log(`   Status: ${res.statusCode}`);
        
        try {
          const responseData = typeof data === 'string' ? JSON.parse(data) : data;
          
          // Log success/error status
          if (responseData.success !== undefined) {
            console.log(`   Success: ${responseData.success}`);
          }
          
          // Log message if present
          if (responseData.message) {
            console.log(`   Message: ${responseData.message}`);
          }
          
          // Log data summary for successful responses
          if (responseData.success && responseData.data) {
            if (Array.isArray(responseData.data)) {
              console.log(`   Data: Array with ${responseData.data.length} items`);
              if (responseData.data.length > 0 && responseData.data[0]._id) {
                console.log(`   First item ID: ${responseData.data[0]._id}`);
                console.log(`   First item name: ${responseData.data[0].name || responseData.data[0].title || 'N/A'}`);
              }
            } else if (typeof responseData.data === 'object') {
              console.log(`   Data ID: ${responseData.data._id || 'N/A'}`);
              console.log(`   Data name: ${responseData.data.name || responseData.data.title || 'N/A'}`);
              
              // Special logging for folder operations
              if (responseData.data.folderType) {
                console.log(`   Folder Type: ${responseData.data.folderType}`);
                console.log(`   Full Path: ${responseData.data.fullPath || 'N/A'}`);
                console.log(`   Level: ${responseData.data.level}`);
              }
            }
          }
          
          // Log errors
          if (responseData.errors) {
            console.log(`   Errors: ${JSON.stringify(responseData.errors, null, 2)}`);
          }
          
        } catch (e) {
          console.log(`   Response: [Cannot parse JSON - Raw length: ${data.length}]`);
        }
        
        console.log(`   Time: ${new Date().toISOString()}`);
        console.log('─'.repeat(80));
      }
      
      originalSend.call(this, data);
    };
    
    next();
  });
} else {
  // Production logging - more concise
  app.use(morgan('combined'));
}

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV
  });
});

// API status endpoint
app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'BamiHustle Backend API',
    version: '1.0.0',
    documentation: '/api-docs',
    endpoints: {
      auth: '/api/auth',
      folders: '/api/folders',
      materials: '/api/materials',
      health: '/health'
    }
  });
});

// Mount routers
app.use('/api/auth', require('./routes/auth'));
app.use('/api/folders', require('./routes/folders'));
app.use('/api/materials', require('./routes/materials'));

// Handle undefined routes
app.all('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

// Error handler middleware (must be last)
app.use(errorHandler);

// Handle unhandled promise rejections
process.on('unhandledRejection', (err, promise) => {
  console.log(`Error: ${err.message}`);
  // Close server & exit process
  if (server) {
    server.close(() => {
      process.exit(1);
    });
  } else {
    process.exit(1);
  }
});

// Handle uncaught exceptions
process.on('uncaughtException', (err) => {
  console.log(`Error: ${err.message}`);
  console.log('Shutting down the server due to Uncaught Exception');
  process.exit(1);
});

// Handle SIGTERM
process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  if (server) {
    server.close(() => {
      console.log('Process terminated');
    });
  }
});

// Handle SIGINT (Ctrl+C)
process.on('SIGINT', () => {
  console.log('SIGINT received');
  if (server) {
    server.close(() => {
      console.log('Process terminated');
    });
  } else {
    process.exit(0);
  }
});

const PORT = process.env.PORT || 5000;

const server = app.listen(PORT, () => {
  console.log('\n' + '═'.repeat(60));
  console.log('🚀 BAMIHUSTLE BACKEND SERVER STARTED');
  console.log('═'.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`📊 Morgan Logging: ${process.env.NODE_ENV === 'development' ? 'ENHANCED ✅' : 'STANDARD ✅'}`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
  console.log('');
  console.log('📁 FOLDER HIERARCHY API ENDPOINTS:');
  console.log('   GET    /api/folders                    - Get folder tree');
  console.log('   GET    /api/folders/stats             - Get folder statistics');
  console.log('   GET    /api/folders/for-materials     - Get folders for materials');
  console.log('   GET    /api/folders/:id               - Get single folder');
  console.log('   POST   /api/folders                   - Create new folder (generic)');
  console.log('   POST   /api/folders/parent            - Create parent folder (Level 0)');
  console.log('   POST   /api/folders/child             - Create child folder (Level 1)');
  console.log('   POST   /api/folders/grandchild        - Create grandchild folder (Level 2)');
  console.log('   PUT    /api/folders/:id               - Update folder');
  console.log('   PUT    /api/folders/:id/move          - Move folder');
  console.log('   DELETE /api/folders/:id               - Delete folder');
  console.log('');
  console.log('📄 MATERIAL API ENDPOINTS:');
  console.log('   GET    /api/materials                 - Get materials');
  console.log('   POST   /api/materials                 - Upload material');
  console.log('   GET    /api/materials/:id             - Get single material');
  console.log('   PUT    /api/materials/:id             - Update material');
  console.log('   DELETE /api/materials/:id             - Delete material');
  console.log('');
  console.log('🔐 AUTH API ENDPOINTS:');
  console.log('   POST   /api/auth/register             - Register user');
  console.log('   POST   /api/auth/login                - Login user');
  console.log('   GET    /api/auth/me                   - Get current user');
  console.log('');
  if (process.env.NODE_ENV === 'development') {
    console.log('🐛 DEVELOPMENT MODE: Enhanced logging active');
    console.log('   - Detailed request/response logging');
    console.log('   - Color-coded API endpoint identification');
    console.log('   - User authentication tracking');
    console.log('   - Request/response body logging');
    console.log('');
  }
  console.log('═'.repeat(60) + '\n');
});

module.exports = app;