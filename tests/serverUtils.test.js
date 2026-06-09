'use strict';

/**
 * serverUtils.test.js — 35 pure-logic tests, no database required.
 *
 * Coverage:
 *   E01–E07  errorHandler middleware          (middleware/error.js)
 *   A01–A02  apiVersion middleware            (middleware/apiVersion.js)
 *   R01–R03  requestId middleware             (middleware/requestId.js)
 *   (cache utilities suite removed — cache.js deleted from project)
 *   N01–N04  validateEnv                     (utils/validateEnv.js)
 *   L01–L03  logger helpers                  (utils/logger.js)
 *   PM01–PM05 Payment model methods/virtuals (models/Payment.js)
 *   BI01–BI03 BillingItem model methods      (models/BillingItem.js)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — errorHandler middleware
// ─────────────────────────────────────────────────────────────────────────────
describe('errorHandler middleware', () => {
  const errorHandler = require('../middleware/error');

  function runError(err) {
    let statusSent, jsonSent;
    const res = {
      status: (code) => { statusSent = code; return res; },
      json:   (body) => { jsonSent  = body; return res; }
    };
    errorHandler(err, {}, res, jest.fn());
    return { statusSent, jsonSent };
  }

  // E01 — Mongoose CastError → 404
  test('E01: CastError returns 404 "Resource not found"', () => {
    const err = new Error('Cast to ObjectId failed');
    err.name = 'CastError';
    const { statusSent, jsonSent } = runError(err);
    expect(statusSent).toBe(404);
    expect(jsonSent.success).toBe(false);
    expect(jsonSent.message).toBe('Resource not found');
  });

  // E02 — Mongoose duplicate key (code 11000) → 400
  test('E02: duplicate key error (code 11000) returns 400', () => {
    const err = new Error('E11000 duplicate key');
    err.code = 11000;
    const { statusSent, jsonSent } = runError(err);
    expect(statusSent).toBe(400);
    expect(jsonSent.message).toBe('Duplicate field value entered');
  });

  // E03 — Mongoose ValidationError → 400 with field messages
  test('E03: ValidationError returns 400 with field messages array', () => {
    const err = new Error('Validation failed');
    err.name = 'ValidationError';
    err.errors = {
      name:   { message: 'Name is required' },
      amount: { message: 'Amount must be positive' }
    };
    const { statusSent, jsonSent } = runError(err);
    expect(statusSent).toBe(400);
    expect(Array.isArray(jsonSent.message)).toBe(true);
    expect(jsonSent.message).toContain('Name is required');
    expect(jsonSent.message).toContain('Amount must be positive');
  });

  // E04 — JWT invalid → 401
  test('E04: JsonWebTokenError returns 401 "Invalid token"', () => {
    const err = new Error('invalid signature');
    err.name = 'JsonWebTokenError';
    const { statusSent, jsonSent } = runError(err);
    expect(statusSent).toBe(401);
    expect(jsonSent.message).toBe('Invalid token');
  });

  // E05 — JWT expired → 401
  test('E05: TokenExpiredError returns 401 "Token expired"', () => {
    const err = new Error('jwt expired');
    err.name = 'TokenExpiredError';
    const { statusSent, jsonSent } = runError(err);
    expect(statusSent).toBe(401);
    expect(jsonSent.message).toBe('Token expired');
  });

  // E06 — Generic unknown error → 500 "Server Error"
  test('E06: unknown error without statusCode returns 500', () => {
    const err = new Error('something unexpected');
    const { statusSent, jsonSent } = runError(err);
    expect(statusSent).toBe(500);
    expect(jsonSent.success).toBe(false);
    expect(jsonSent.message).toBe('something unexpected');
  });

  // E07 — Error with custom statusCode is respected
  test('E07: error with pre-set statusCode uses that code', () => {
    const err = new Error('Forbidden');
    err.statusCode = 403;
    const { statusSent, jsonSent } = runError(err);
    expect(statusSent).toBe(403);
    expect(jsonSent.message).toBe('Forbidden');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — apiVersion middleware
// ─────────────────────────────────────────────────────────────────────────────
describe('apiVersion middleware', () => {
  const { versioningMiddleware, apiVersion } = require('../middleware/apiVersion');

  function runVersioning() {
    const req = {};
    const headers = {};
    const res = { setHeader: (k, v) => { headers[k] = v; } };
    const next = jest.fn();
    versioningMiddleware(req, res, next);
    return { req, headers, next };
  }

  // A01 — sets req.apiVersion to 'v1'
  test('A01: sets req.apiVersion = "v1"', () => {
    const { req } = runVersioning();
    expect(req.apiVersion).toBe('v1');
  });

  // A02 — sets API-Version response header and calls next
  test('A02: sets API-Version header and calls next()', () => {
    const { headers, next } = runVersioning();
    expect(headers['API-Version']).toBe(apiVersion);
    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — requestId middleware
// uuid v13 uses ESM — mock it so Jest can load the CJS middleware
// ─────────────────────────────────────────────────────────────────────────────
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
}));

describe('requestId middleware', () => {
  let requestIdMiddleware;

  beforeAll(() => {
    jest.resetModules();
    jest.mock('uuid', () => ({ v4: jest.fn(() => 'aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee') }));
    requestIdMiddleware = require('../middleware/requestId');
  });

  function runRequestId(headers = {}) {
    const req = { headers };
    const resHeaders = {};
    const res = { setHeader: (k, v) => { resHeaders[k] = v; } };
    const next = jest.fn();
    requestIdMiddleware(req, res, next);
    return { req, resHeaders, next };
  }

  // R01 — uses x-request-id header if already present
  test('R01: uses existing x-request-id header value', () => {
    const { req, resHeaders } = runRequestId({ 'x-request-id': 'my-trace-id' });
    expect(req.id).toBe('my-trace-id');
    expect(resHeaders['X-Request-ID']).toBe('my-trace-id');
  });

  // R02 — falls back to generated id when no header provided
  test('R02: falls back to generated id when x-request-id header is absent', () => {
    const { req, resHeaders } = runRequestId({});
    expect(typeof req.id).toBe('string');
    expect(req.id.length).toBeGreaterThan(0);
    expect(resHeaders['X-Request-ID']).toBe(req.id);
  });

  // R03 — calls next() in both cases
  test('R03: next() is always called', () => {
    const { next } = runRequestId({ 'x-request-id': 'abc' });
    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — validateEnv
// ─────────────────────────────────────────────────────────────────────────────
describe('validateEnv', () => {
  let originalEnv;

  beforeEach(() => {
    originalEnv = { ...process.env };
    // Provide the three required vars so process.exit is never called
    process.env.MONGODB_URI = 'mongodb://localhost:27017/test';
    process.env.JWT_SECRET  = 'test-secret';
    process.env.JWT_EXPIRE  = '7d';
    process.env.NODE_ENV    = 'test';
    // Remove optional vars so they get defaulted
    delete process.env.PORT;
    delete process.env.RATE_LIMIT_WINDOW_MS;
    delete process.env.RATE_LIMIT_MAX_REQUESTS;
    delete process.env.LOG_LEVEL;
    jest.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  // N01 — returns { valid: true } when all required vars present
  test('N01: returns { valid: true } when required env vars are set', () => {
    const { validateEnv } = require('../utils/validateEnv');
    const result = validateEnv();
    expect(result.valid).toBe(true);
  });

  // N02 — sets default PORT (4000) when not defined
  test('N02: sets default PORT=4000 when PORT is not in env', () => {
    const { validateEnv } = require('../utils/validateEnv');
    validateEnv();
    expect(String(process.env.PORT)).toBe('4000');
  });

  // N03 — sets default LOG_LEVEL to "info" when not defined
  test('N03: sets default LOG_LEVEL="info" when not set', () => {
    const { validateEnv } = require('../utils/validateEnv');
    validateEnv();
    expect(process.env.LOG_LEVEL).toBe('info');
  });

  // N04 — requiredEnvVars export contains mandatory keys
  test('N04: requiredEnvVars export lists MONGODB_URI, JWT_SECRET, JWT_EXPIRE', () => {
    const { requiredEnvVars } = require('../utils/validateEnv');
    expect(requiredEnvVars).toContain('MONGODB_URI');
    expect(requiredEnvVars).toContain('JWT_SECRET');
    expect(requiredEnvVars).toContain('JWT_EXPIRE');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — logger helpers
// ─────────────────────────────────────────────────────────────────────────────
describe('logger helpers', () => {
  const { logError, logInfo, logWarning } = require('../utils/logger');

  // L01 — logError returns an errorDetails object with the expected shape
  test('L01: logError returns errorDetails with endpoint, context, and error keys', () => {
    const err = new Error('test error');
    const result = logError('POST /test', err, { userId: 'u1' });
    expect(result).toHaveProperty('endpoint', 'POST /test');
    expect(result).toHaveProperty('context');
    expect(result).toHaveProperty('error');
    expect(result.error.message).toBe('test error');
  });

  // L02 — logError handles a null/undefined error gracefully (no throw)
  test('L02: logError handles null error without throwing', () => {
    expect(() => logError('GET /test', null, {})).not.toThrow();
    const result = logError('GET /test', null);
    expect(result.error.message).toBe('No message provided');
  });

  // L03 — logInfo and logWarning do not throw
  test('L03: logInfo and logWarning never throw', () => {
    expect(() => logInfo('hello', { key: 'val' })).not.toThrow();
    expect(() => logWarning('watch out', {})).not.toThrow();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 7 — Payment model methods and virtuals (no DB connection)
// ─────────────────────────────────────────────────────────────────────────────
describe('Payment model — methods and virtuals', () => {
  const mongoose = require('mongoose');
  const Payment = require('../models/Payment');

  // Build a minimal Payment instance without saving (no DB needed)
  function makePayment(overrides = {}) {
    const doc = new Payment({
      user:        new mongoose.Types.ObjectId(),
      admin:       new mongoose.Types.ObjectId(),
      createdBy:   new mongoose.Types.ObjectId(),
      paymentType: 'rent',
      amount:      45000,
      currency:    'NGN',
      paymentStatus: 'pending',
      ...overrides
    });
    return doc;
  }

  // PM01 — canRefund virtual: true when deposit is refundable and not yet refunded
  test('PM01: canRefund is true for unrefunded refundable deposit', () => {
    const p = makePayment({ isDeposit: true, depositRefundable: true });
    expect(p.canRefund).toBe(true);
  });

  // PM02 — canRefund virtual: false once depositRefundedDate is set
  test('PM02: canRefund is false after depositRefundedDate is set', () => {
    const p = makePayment({ isDeposit: true, depositRefundable: true, depositRefundedDate: new Date() });
    expect(p.canRefund).toBe(false);
  });

  // PM03 — canRefund virtual: false when not a deposit
  test('PM03: canRefund is false for non-deposit payment', () => {
    const p = makePayment({ isDeposit: false });
    expect(p.canRefund).toBe(false);
  });

  // PM04 — getFormattedAmount returns NGN currency string
  test('PM04: getFormattedAmount returns NGN-formatted string', () => {
    const p = makePayment({ amount: 45000 });
    const formatted = p.getFormattedAmount();
    expect(typeof formatted).toBe('string');
    expect(formatted).toMatch(/45/); // contains the amount digits
  });

  // PM05 — getStatusBadge maps all statuses to emoji strings
  test('PM05: getStatusBadge returns emoji label for each status', () => {
    const statuses = ['pending', 'initiated', 'completed', 'failed', 'refunded'];
    statuses.forEach(status => {
      const p = makePayment({ paymentStatus: status });
      const badge = p.getStatusBadge();
      expect(typeof badge).toBe('string');
      expect(badge.length).toBeGreaterThan(0);
    });
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 8 — BillingItem model methods and virtuals
// ─────────────────────────────────────────────────────────────────────────────
describe('BillingItem model — category virtual and getFormattedAmount', () => {
  const mongoose = require('mongoose');
  const BillingItem = require('../models/BillingItem');

  function makeBillingItem(itemType, amount = 5000) {
    return new BillingItem({
      user:      new mongoose.Types.ObjectId(),
      createdBy: new mongoose.Types.ObjectId(),
      itemType,
      label:  `Test ${itemType}`,
      amount,
      currency: 'NGN'
    });
  }

  // BI01 — utility types map to 'utilities' category
  test('BI01: water_bill and electricity_bill map to "utilities" category', () => {
    expect(makeBillingItem('water_bill').category).toBe('utilities');
    expect(makeBillingItem('electricity_bill').category).toBe('utilities');
  });

  // BI02 — service types map to 'service' or 'facility' category
  test('BI02: cleaning_service → "service", parking_space → "facility"', () => {
    expect(makeBillingItem('cleaning_service').category).toBe('service');
    expect(makeBillingItem('parking_space').category).toBe('facility');
    expect(makeBillingItem('maintenance_fee').category).toBe('service');
    expect(makeBillingItem('garden_maintenance').category).toBe('service');
  });

  // BI03 — getFormattedAmount returns currency-formatted string
  test('BI03: getFormattedAmount returns a string containing the amount', () => {
    const item = makeBillingItem('other', 12500);
    const formatted = item.getFormattedAmount();
    expect(typeof formatted).toBe('string');
    expect(formatted).toMatch(/12/); // at minimum contains part of 12500
  });
});
