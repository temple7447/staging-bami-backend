const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const compression = require('compression');
const swaggerUi = require('swagger-ui-express');
const mongoose = require('mongoose');

const connectDatabase = require('./config/database');
const errorHandler = require('./middleware/error');
const slackLogger = require('./middleware/slackLogger');
const requestIdMiddleware = require('./middleware/requestId');
const sanitizationMiddleware = require('./middleware/sanitization');
const { versioningMiddleware, apiVersion } = require('./middleware/apiVersion');
const { initializeScheduler } = require('./utils/scheduler');
const { ensureAllUsersHaveWallets } = require('./utils/ensureWallets');
const { ensureCloudinaryConfigured } = require('./config/cloudinary');
const { getMailtrapStatus } = require('./utils/emailService');
const swaggerSpec = require('./config/swagger');
const { validateEnv } = require('./utils/validateEnv');
const { logger } = require('./utils/logger');

dotenv.config();
validateEnv();

const app = express();

const serverStart = async () => {
  try {
    await connectDatabase();
    logger.info('Database connected successfully');
    
    // Ensure all users have wallets (run on every server start)
    console.log('\n' + '='.repeat(50));
    console.log('🚀 STARTING WALLET CHECK ON SERVER BOOT');
    console.log('='.repeat(50));
    const walletCheck = await ensureAllUsersHaveWallets();
    console.log('='.repeat(50));
    console.log('✅ Wallet check completed on server boot\n');
  } catch (error) {
    logger.error('Failed to connect to database', { error: error.message });
    process.exit(1);
  }
};

serverStart();

app.set('trust proxy', 1);
app.set('etag', false);
app.use((req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });

const allowedOrigins = process.env.ALLOWED_ORIGINS 
  ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
  : [
      'http://localhost:3000', 
      'http://localhost:5173',
      'http://localhost:8080',
      'https://www.bamihost.com',
      'https://staging-baminhost.vercel.app'
    ];

const corsOptions = {
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'X-Request-ID'],
};

app.use(cors(corsOptions));
app.options('*', cors(corsOptions));

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      scriptSrc: ["'self'"],
      imgSrc: ["'self'", "data:", "https:"],
      connectSrc: ["'self'", "https://api.paystack.co"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

const limiter = rateLimit({
  windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000,
  max: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200,
  message: {
    success: false,
    message: 'Too many requests from this IP, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.method === 'OPTIONS',
});

app.use(limiter);

app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.use(requestIdMiddleware);
app.use(sanitizationMiddleware);
app.use(versioningMiddleware);

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
  
  logger.info('Incoming request', {
    method: req.method,
    url: req.originalUrl,
    query: req.query,
    auth: authPresent,
    contentType: ct || 'n/a',
    body: bodyLog,
    requestId: req.id
  });

  res.on('finish', () => {
    const dur = Date.now() - started;
    const len = res.get('Content-Length') || '0';
    logger.info('Request completed', {
      method: req.method,
      url: req.originalUrl,
      statusCode: res.statusCode,
      contentLength: len,
      duration: dur,
      requestId: req.id
    });
  });

  next();
});

app.use(slackLogger);

if (process.env.NODE_ENV === 'development') {
  app.use(morgan('dev', { stream: logger.stream }));
} else {
  app.use(morgan('combined', { stream: logger.stream }));
}

app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec, {
  swaggerOptions: {
    persistAuthorization: true,
    displayOperationId: true
  },
  customCss: '.swagger-ui .topbar { display: none }'
}));

let dbStatus = 'disconnected';
let schedulerStatus = 'not initialized';

try {
  initializeScheduler();
  schedulerStatus = 'running';
} catch (error) {
  logger.warn('Scheduler initialization failed', { error: error.message });
}

const getHealthStatus = async () => {
  const health = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    apiVersion
  };

  try {
    if (mongoose.connection.readyState === 1) {
      dbStatus = 'connected';
      health.database = { status: 'connected' };
    } else {
      dbStatus = 'disconnected';
      health.database = { status: 'disconnected' };
      health.status = 'degraded';
    }
  } catch (error) {
    dbStatus = 'error';
    health.database = { status: 'error', error: error.message };
    health.status = 'unhealthy';
  }

  health.services = {
    database: dbStatus,
    scheduler: schedulerStatus
  };

  return health;
};

app.get('/health', async (req, res) => {
  const health = await getHealthStatus();
  const statusCode = health.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json({
    success: health.status === 'healthy',
    ...health
  });
});

app.get('/health/ready', async (req, res) => {
  const health = await getHealthStatus();
  if (health.status === 'healthy') {
    res.status(200).json({ ready: true });
  } else {
    res.status(503).json({ ready: false, ...health });
  }
});

app.get('/health/live', (req, res) => {
  res.status(200).json({ alive: true });
});

app.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'BamiHustle Backend API',
    version: '1.0.0',
    apiVersion,
    documentation: '/api-docs',
    endpoints: {
      auth: '/api/auth',
      estates: '/api/estates',
      health: '/health',
      readiness: '/health/ready',
      liveness: '/health/live'
    }
  });
});

app.use('/api/auth', require('./routes/auth'));
app.use('/api/estates', require('./routes/estates'));
app.use('/api/estates', require('./routes/units'));
app.use('/api/estates', require('./routes/distribution'));
app.use('/api/tenants', require('./routes/tenants'));
app.use('/api/estates/:estateId/tenants', require('./routes/tenants'));
app.use('/api/payments', require('./routes/payments'));
app.use('/api/billing', require('./routes/billing'));
app.use('/api/wallet', require('./routes/wallet'));
app.use('/api/wallets', require('./routes/distribution'));
app.use('/api/upload', require('./routes/upload'));
app.use('/api/subscriptions', require('./routes/subscriptions'));
app.use('/api/business-types', require('./routes/businessTypes'));
app.use('/api/service-requests', require('./routes/serviceRequests'));
app.use('/api/withdrawals', require('./routes/withdrawals'));
app.use('/api/notifications', require('./routes/notifications'));
app.use('/api/vendor-manager-payout', require('./routes/vendorManagerPayout'));
app.use('/api/dashboard', require('./routes/dashboard'));
app.use('/api/issues', require('./routes/issues'));
app.use('/api/rental-applications', require('./routes/rentalApplications'));
app.use('/api/enquiries', require('./routes/enquiries'));

// Test routes for manual triggers
const { triggerMonthlyReport, getSchedulerStatus, triggerVendorManagerPayout } = require('./utils/scheduler');

app.get('/api/test/send-monthly-report', async (req, res) => {
  try {
    const result = await triggerMonthlyReport();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/test/trigger-vendor-manager-payout', async (req, res) => {
  try {
    const result = await triggerVendorManagerPayout();
    res.json(result);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

app.get('/api/test/scheduler-status', (req, res) => {
  const status = getSchedulerStatus();
  res.json(status);
});

app.all('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.originalUrl} not found`
  });
});

app.use(errorHandler);

const gracefulShutdown = (signal) => {
  logger.info(`${signal} received, starting graceful shutdown`);
  
  if (server) {
    server.close(async (err) => {
      if (err) {
        logger.error('Error during server close', { error: err.message });
        process.exit(1);
      }
      
      logger.info('HTTP server closed');
      
      try {
        await mongoose.connection.close();
        logger.info('Database connection closed');
      } catch (dbErr) {
        logger.error('Error closing database connection', { error: dbErr.message });
      }
      
      logger.info('Graceful shutdown completed');
      process.exit(0);
    });
  } else {
    process.exit(0);
  }
};

process.on('unhandledRejection', (err) => {
  logger.error('Unhandled Promise Rejection', { error: err.message, stack: err.stack });
  gracefulShutdown('unhandledRejection');
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception', { error: err.message, stack: err.stack });
  gracefulShutdown('uncaughtException');
});

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

const PORT = process.env.PORT || 4000;

const server = app.listen(PORT, () => {
  logger.info(`
╔══════════════════════════════════════════════════════════════╗
║           BAMIHUSTLE BACKEND SERVER STARTED                  ║
╠══════════════════════════════════════════════════════════════╣
║  📍 Port: ${PORT}
║  🌍 Environment: ${process.env.NODE_ENV}
║  📦 API Version: ${apiVersion}
║  🏥 Health Check: http://localhost:${PORT}/health
╚══════════════════════════════════════════════════════════════╝
  `);

  const emailStatus = getMailtrapStatus();
  let cloudinaryMsg = 'READY';
  try { ensureCloudinaryConfigured(); } catch (e) { cloudinaryMsg = `MISSING: ${e.message.replace('Missing Cloudinary env vars: ', '')}`; }
  
  logger.info('Service Status', {
    mailtrap: emailStatus.ok ? 'READY' : `MISSING: ${emailStatus.missing.join(', ')}`,
    cloudinary: cloudinaryMsg,
    scheduler: schedulerStatus,
    database: dbStatus
  });
});

module.exports = app;
