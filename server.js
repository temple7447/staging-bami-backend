const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');

const connectDatabase = require('./config/database');
const errorHandler = require('./middleware/error');
const { initializeScheduler } = require('./utils/scheduler');
const { ensureCloudinaryConfigured } = require('./config/cloudinary');
const { getMailtrapStatus } = require('./utils/emailService');
const swaggerSpec = require('./config/swagger');

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
  origin: true, // Allow all origins
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

// Swagger documentation
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  swaggerOptions: {
    persistAuthorization: true,
    displayOperationId: true
  },
  customCss: '.swagger-ui .topbar { display: none }'
}));

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Server is running',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV,
    documentation: '/api-docs'
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
app.use('/api/estates', require('./routes/units'));
app.use('/api/estates', require('./routes/distribution'));
app.use('/api/tenants', require('./routes/tenants'));
app.use('/api/estates/:estateId/tenants', require('./routes/tenants'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/business-types', require('./routes/businessTypes'));

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

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  console.log('\n' + '═'.repeat(60));
  console.log('🚀 BAMIHUSTLE BACKEND SERVER STARTED');
  console.log('═'.repeat(60));
  console.log(`📍 Port: ${PORT}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🏥 Health Check: http://localhost:${PORT}/health`);

  // Print integrations readiness
  const emailStatus = getMailtrapStatus();
  let cloudinaryMsg = 'READY';
  try { ensureCloudinaryConfigured(); } catch (e) { cloudinaryMsg = `MISSING ${e.message.replace('Missing Cloudinary env vars: ', '')}`; }
  console.log('');
  console.log(`✉️  Mailtrap: ${emailStatus.ok ? 'READY' : 'MISSING ' + emailStatus.missing.join(', ')}`);
  console.log(`☁️  Cloudinary: ${cloudinaryMsg}`);
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
  console.log('🏠 UNIT API ENDPOINTS:');
  console.log('   POST   /api/estates/:estateId/units         - Create unit for estate');
  console.log('   GET    /api/estates/:estateId/units         - Get all units for estate');
  console.log('   GET    /api/estates/:estateId/units/vacant  - Get vacant units (for tenant assignment)');
  console.log('   GET    /api/estates/unit/:unitId            - Get unit details');
  console.log('   PUT    /api/estates/unit/:unitId            - Update unit');
  console.log('   POST   /api/estates/unit/:unitId/assign-tenant - Assign tenant to unit');
  console.log('   POST   /api/estates/unit/:unitId/remove-tenant - Remove tenant from unit');
  console.log('   DELETE /api/estates/unit/:unitId            - Delete unit');
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
  console.log('💰 WALLET API ENDPOINTS:');
  console.log('   GET    /api/wallet                    - Get wallet balance');
  console.log('   POST   /api/wallet                    - Create wallet');
  console.log('   POST   /api/wallet/add-funds          - Add funds to wallet');
  console.log('   POST   /api/wallet/deduct-funds       - Deduct funds from wallet');
  console.log('   PUT    /api/wallet/currency           - Update wallet currency');
  console.log('');
  console.log('💳 PAYMENT API ENDPOINTS (Paystack Integration):');
  console.log('   POST   /api/payments/deposit          - Initiate tenant deposit payment');
  console.log('   POST   /api/payments/rent             - Initiate rent payment');
  console.log('   POST   /api/payments/service-charge   - Initiate service charge payment');
  console.log('   POST   /api/payments/security-charge  - Initiate security charge payment');
  console.log('   POST   /api/payments/caution-fee      - Initiate caution fee payment');
  console.log('   POST   /api/payments/legal-fee        - Initiate legal fee payment');
  console.log('   GET    /api/payments/:paymentId       - Get payment status');
  console.log('   GET    /api/payments/tenant/:id       - Get tenant payment history');
  console.log('   GET    /api/payments/estate/:id       - Get estate payments');
  console.log('   POST   /api/payments/callback         - Payment webhook callback');
  console.log('   POST   /api/payments/:id/refund       - Refund deposit');
  console.log('');
  console.log('📧 SCHEDULER SERVICES:');
  console.log('   Daily reminder check at 08:00 AM      - Sends rent payment reminders (7, 3, 1 day)');
  console.log('');
  console.log('═'.repeat(60) + '\n');
});

module.exports = app;
