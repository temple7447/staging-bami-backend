const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');

const connectDatabase = require('./config/database');
const errorHandler = require('./middleware/error');
const { initializeScheduler } = require('./utils/scheduler');

// Load env vars
dotenv.config();

// Connect to database
connectDatabase();

const app = express();

// Initialize reminder scheduler
try {
  initializeScheduler();
} catch (error) {
  console.error('Failed to initialize reminder scheduler:', error.message);
}

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
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 100,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

app.use(limiter);

// CORS configuration
const corsOptions = {
  origin: function (origin, callback) {
    if (!origin) return callback(null, true);
    if (process.env.NODE_ENV === 'development') {
      return callback(null, true);
    }
    const allowedOrigins = [
      'http://localhost:3000',
      'http://localhost:3001',
      'http://localhost:8080',
      'http://localhost:8081',
      'https://bami-hustle.vercel.app',
      'https://bumi-hustle.vercel.app',
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

// Compression and body parsing
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Request logging - log all frontend requests with safe body masking
app.use((req, res, next) => {
  const started = Date.now();
  const ct = req.headers['content-type'] || '';
  const authPresent = req.headers['authorization'] ? 'present' : 'none';
  let bodyLog = '';
  if (ct.includes('multipart/form-data')) {
    bodyLog = '[FILE UPLOAD]';
  } else if (req.body && Object.keys(req.body).length > 0) {
    const clone = { ...req.body };
    ['password', 'pass', 'token', 'authorization', 'apiKey', 'secret'].forEach(k => {
      if (clone[k] !== undefined) clone[k] = '[REDACTED]';
    });
    const raw = JSON.stringify(clone);
    bodyLog = raw.length > 1000 ? raw.slice(0, 1000) + '…' : raw;
  }
  console.log(`[REQ] ${new Date().toISOString()} ${req.method} ${req.originalUrl} auth:${authPresent} ct:${ct || 'n/a'} query=${JSON.stringify(req.query)} body=${bodyLog}`);

  res.on('finish', () => {
    const dur = Date.now() - started;
    const len = res.get('Content-Length') || '0';
    console.log(`[RES] ${req.method} ${req.originalUrl} -> ${res.statusCode} ${len}b ${dur}ms`);
  });

  next();
});

// Logging
if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev'));
} else {
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
      estates: '/api/estates',
      health: '/health'
    }
  });
});

// Mount routers
app.use('/api/auth', require('./routes/auth'));
app.use('/api/estates', require('./routes/estates'));
app.use('/api/tenants', require('./routes/tenants'));
app.use('/api/estates/:estateId/tenants', require('./routes/tenants'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/upload', require('./routes/upload'));

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
process.on('unhandledRejection', (err) => {
  console.log(`Error: ${err.message}`);
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
  console.log(`🏥 Health Check: http://localhost:${PORT}/health`);
  console.log('');
  console.log('🔐 AUTH API ENDPOINTS:');
  console.log('   POST   /api/auth/register             - Register user');
  console.log('   POST   /api/auth/login                - Login user');
  console.log('   GET    /api/auth/me                   - Get current user');
  console.log('');
  console.log('🏢 ESTATE API ENDPOINTS:');
  console.log('   GET    /api/estates                   - List estates');
  console.log('   GET    /api/estates/:id               - Get estate by id');
  console.log('   POST   /api/estates                   - Create estate');
  console.log('   PUT    /api/estates/:id               - Update estate');
  console.log('   DELETE /api/estates/:id               - Delete estate');
  console.log('');
  console.log('👥 TENANT API ENDPOINTS:');
  console.log('   GET    /api/tenants                   - List tenants');
  console.log('   GET    /api/tenants/:id               - Get tenant by id');
  console.log('   POST   /api/estates/:estateId/tenants - Add tenant to an estate');
  console.log('   PUT    /api/tenants/:id               - Update tenant');
  console.log('   DELETE /api/tenants/:id               - Delete tenant');
  console.log('');
  console.log('🗂️  UPLOAD API ENDPOINTS:');
  console.log('   POST   /api/upload/image              - Upload a single image (field: file)');
  console.log('   POST   /api/upload/video              - Upload a single video (field: file)');
  console.log('');
  console.log('📧 SCHEDULER SERVICES:');
  console.log('   Daily reminder check at 08:00 AM      - Sends rent payment reminders (7, 3, 1 day)');
  console.log('');
  console.log('═'.repeat(60) + '\n');
  console.log('   GET    /api/wallet                    - Get wallet balance');
  console.log('   POST   /api/wallet                    - Create wallet');
  console.log('   POST   /api/wallet/add-funds          - Add funds to wallet');
  console.log('   POST   /api/wallet/deduct-funds       - Deduct funds from wallet');
  console.log('   PUT    /api/wallet/currency           - Update wallet currency');
  console.log('');
  console.log('═'.repeat(60) + '\n');
});

module.exports = app;
