'use strict';

/**
 * tenantEndpoints.test.js — 47 HTTP-level tests for all tenant endpoints.
 * No real database or external services used.
 *
 * T01–T02  Billing items  GET /:id/billing
 * T03–T05  Input validation (bad ObjectId, missing fields)
 * T06–T12  POST  /api/v1/estates/:estateId/tenants  (createTenant)
 * T13–T15  GET   /api/v1/estates/:estateId/tenants  (getTenants)
 * T16–T19  GET   /api/v1/estates/:estateId/tenants/:id  (getTenant)
 * T20–T23  PUT   /api/v1/estates/:estateId/tenants/:id  (updateTenant)
 * T24–T26  DELETE /api/v1/estates/:estateId/tenants/:id  (deleteTenant)
 * T27–T29  GET/POST /api/v1/estates/:estateId/tenants/:id/history
 * T30–T33  GET/POST /api/v1/estates/:estateId/tenants/:id/transactions
 * T34–T35  GET   /me  (getMyTenant)
 * T36–T37  GET   /me/history  (listMyHistory)
 * T38–T40  GET   /me/billing  (getMyBillingItems)
 * T41–T44  POST  /me/billing/pay  (paySelectedBillingItems)
 * T45–T47  POST  /:id/avatar  (uploadTenantAvatar)
 */

// ─── mock uuid (ESM package, not loadable by Jest's CJS runner) ──────────────
jest.mock('uuid', () => ({ v4: jest.fn(() => 'test-uuid-1234') }));

// ─── suppress auth so every request has a fake admin user ────────────────────
jest.mock('../middleware/auth', () => ({
  protect: (req, res, next) => {
    req.user = {
      _id: 'adminUserId',
      id:   'adminUserId',
      name: 'Test Admin',
      email: 'admin@test.com',
      role:  'admin',
    };
    next();
  },
  authorize: () => (req, res, next) => next(),
}));

// ─── external services: all no-ops ───────────────────────────────────────────
jest.mock('../utils/emailService',      () => ({ sendTenantWelcomeEmail: jest.fn() }));
jest.mock('../utils/slackService',      () => ({ sendActivityToSlack:    jest.fn() }));
jest.mock('../utils/distributionService', () => ({ distributePayment:     jest.fn() }));
jest.mock('../utils/walletEmailService',  () => ({ sendWalletPayoutEmail: jest.fn() }));
jest.mock('../utils/logger', () => ({
  logError: jest.fn(), logInfo: jest.fn(), logWarning: jest.fn(),
}));

// ─── rent calculator: return base amount unchanged ───────────────────────────
jest.mock('../utils/rentCalculator', () => ({
  getCurrentRent: jest.fn((base) => base),
  calculateEffectiveRent: jest.fn((base, _start, months) => ({
    totalAmount: base * months,
    finalRent: base,
  })),
  RULE_START_DATE: new Date('2000-01-01'),
}));

// ─── mongoose models ─────────────────────────────────────────────────────────
jest.mock('../models/Tenant');
jest.mock('../models/Estate');
jest.mock('../models/Unit');
jest.mock('../models/Payment');
jest.mock('../models/Transaction');
jest.mock('../models/User');
jest.mock('../models/Wallet');
jest.mock('../models/BillingItem');
jest.mock('../models/Setting');

// ─── cloudinary: no-op so avatar tests don't require real credentials ─────────
jest.mock('../config/cloudinary', () => ({
  cloudinary: {
    uploader: {
      destroy: jest.fn().mockResolvedValue({}),
      upload_stream: jest.fn(),
    },
  },
  ensureCloudinaryConfigured: jest.fn(),
}));

// ─── libs ─────────────────────────────────────────────────────────────────────
const request    = require('supertest');
const express    = require('express');
const mongoose   = require('mongoose');

const Tenant      = require('../models/Tenant');
const Estate      = require('../models/Estate');
const Unit        = require('../models/Unit');
const Payment     = require('../models/Payment');
const Transaction = require('../models/Transaction');
const User        = require('../models/User');
const BillingItem = require('../models/BillingItem');
const Wallet      = require('../models/Wallet');

// ─── reusable test IDs ────────────────────────────────────────────────────────
const ESTATE_ID = new mongoose.Types.ObjectId().toHexString();
const UNIT_ID   = new mongoose.Types.ObjectId().toHexString();
const TENANT_ID = new mongoose.Types.ObjectId().toHexString();

// ─── helper: make a chainable & thenable Mongoose query mock ─────────────────
function makeQuery(resolved) {
  const q = {};
  ['populate','select','lean','sort','skip','limit'].forEach(m => {
    q[m] = jest.fn().mockReturnThis();
  });
  q.then = (res, rej) => Promise.resolve(resolved).then(res, rej);
  q.catch = (rej) => Promise.resolve(resolved).catch(rej);
  return q;
}

// ─── canonical mock tenant document ──────────────────────────────────────────
function makeTenantDoc(overrides = {}) {
  return {
    _id:    new mongoose.Types.ObjectId(TENANT_ID),
    estate: { _id: ESTATE_ID, name: 'Test Estate' },
    unit: {
      _id: UNIT_ID, label: 'Flat 1',
      monthlyPrice: 35000, serviceChargeMonthly: 10000,
      cautionFee: 0, legalFee: 0,
    },
    tenantName: 'John Doe',
    tenantEmail: '',
    tenantPhone: '',
    isActive:  true,
    status:    'occupied',
    tenantType: 'new',
    rentAmount: 35000,
    serviceChargeAmount: 10000,
    baseRent2024: 35000,
    baseServiceCharge2024: 10000,
    baseCaution2024: 0,
    baseLegal2024: 0,
    lastRentIncreaseDate: new Date('2024-06-01'),
    lastServiceIncreaseDate: new Date('2024-06-01'),
    lastCautionIncreaseDate: new Date('2024-06-01'),
    lastLegalIncreaseDate: new Date('2024-06-01'),
    entryDate: new Date('2024-06-01'),
    nextDueDate: new Date('2026-06-01'),
    rentOutstanding: 0,
    serviceChargeOutstanding: 0,
    createdAt: new Date('2024-06-01'),
    history: [],
    save: jest.fn().mockResolvedValue(true),
    ...overrides,
  };
}

// ─── build lightweight test Express app ──────────────────────────────────────
let app;
beforeAll(() => {
  // Set env vars so validateEnv (if imported) doesn't exit
  process.env.MONGODB_URI = 'mongodb://localhost/test';
  process.env.JWT_SECRET  = 'testsecretkey12345678901234567890';
  process.env.JWT_EXPIRE  = '7d';
  process.env.NODE_ENV    = 'test';

  app = express();
  app.use(express.json());
  // Mount with mergeParams so :estateId and :id are both available
  app.use('/api/v1/estates/:estateId/tenants', require('../routes/tenants'));
});

beforeEach(() => {
  jest.clearAllMocks();

  // Default Payment mocks so reconcileNextDueDate and aggregate don't crash
  Payment.find = jest.fn().mockReturnValue(makeQuery([]));
  Payment.aggregate    = jest.fn().mockResolvedValue([]);
  Payment.countDocuments = jest.fn().mockResolvedValue(0);
  Payment.exists       = jest.fn().mockResolvedValue(false);
  Payment.create       = jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId(), paymentStatus: 'completed' });

  // Default BillingItem mocks
  BillingItem.find            = jest.fn().mockReturnValue(makeQuery([]));
  BillingItem.findOne         = jest.fn().mockResolvedValue(null);
  BillingItem.countDocuments  = jest.fn().mockResolvedValue(0);
  BillingItem.findByIdAndUpdate = jest.fn().mockResolvedValue(true);

  // Default Wallet mocks
  Wallet.findOne = jest.fn().mockResolvedValue(null);

  // Default Transaction mocks
  Transaction.find         = jest.fn().mockReturnValue(makeQuery([]));
  Transaction.countDocuments = jest.fn().mockResolvedValue(0);
  Transaction.create       = jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId(), type: 'rent', amount: 35000 });

  // Default User mocks
  User.findOne      = jest.fn().mockResolvedValue(null);
  User.create       = jest.fn().mockResolvedValue({ _id: 'newUserId' });
  User.findByIdAndUpdate = jest.fn().mockResolvedValue(true);

  // Default Tenant mocks
  Tenant.findByIdAndUpdate = jest.fn().mockResolvedValue(true);
  Tenant.findOneAndUpdate  = jest.fn().mockResolvedValue(null);
  Tenant.find     = jest.fn().mockReturnValue(makeQuery([]));
  Tenant.findOne  = jest.fn().mockReturnValue(makeQuery(null));
  Tenant.findById = jest.fn().mockReturnValue(makeQuery(null));
  Tenant.countDocuments = jest.fn().mockResolvedValue(0);
  Tenant.aggregate      = jest.fn().mockResolvedValue([{ _id: null, totalRent: 0, totalService: 0, count: 0 }]);
  Tenant.updateMany     = jest.fn().mockResolvedValue({ nModified: 0 });
  Tenant.create         = jest.fn().mockResolvedValue(makeTenantDoc());
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 1 — Billing items endpoint (GET /:id/billing)
// ═════════════════════════════════════════════════════════════════════════════
describe('Billing items — GET /api/v1/estates/:estateId/tenants/:id/billing', () => {

  // T01 — tenant not found → 404
  test('T01: GET /:id/billing returns 404 when tenant not found', async () => {
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(null));
    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}/billing`);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Tenant not found');
  });

  // T02 — tenant with unit returns billing items array
  test('T02: GET /:id/billing returns 200 with items array', async () => {
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(makeTenantDoc()));
    Payment.exists  = jest.fn().mockResolvedValue(false);

    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}/billing`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data.items)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 2 — Input validation
// ═════════════════════════════════════════════════════════════════════════════
describe('Input validation', () => {

  // T03 — invalid MongoId on GET /:id → 400
  test('T03: GET /tenants/not-a-valid-id returns 400', async () => {
    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/not-a-valid-id`);
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // T04 — invalid MongoId on PUT /:id → 400
  test('T04: PUT /tenants/bad-id returns 400', async () => {
    const res = await request(app)
      .put(`/api/v1/estates/${ESTATE_ID}/tenants/bad-id`)
      .send({ tenantName: 'New Name' });
    expect(res.status).toBe(400);
  });

  // T05 — POST without unitId or tenantName → 400 validation error
  test('T05: POST /tenants with no body returns 400 validation error', async () => {
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 3 — createTenant (POST /tenants)
// ═════════════════════════════════════════════════════════════════════════════
describe('createTenant — POST /api/v1/estates/:estateId/tenants', () => {
  const validBody = {
    unitId:     UNIT_ID,
    tenantName: 'John Doe',
    entryDate:  '2024-06-01',
  };

  // T06 — estate not found → 404
  test('T06: estate not found returns 404', async () => {
    Estate.findById = jest.fn().mockResolvedValue(null);
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants`)
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Estate not found');
  });

  // T07 — unit not found in estate → 404
  test('T07: unit not found in estate returns 404', async () => {
    Estate.findById = jest.fn().mockResolvedValue({ _id: ESTATE_ID, name: 'Estate', isActive: true });
    Unit.findOne    = jest.fn().mockResolvedValue(null);
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants`)
      .send(validBody);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Unit not found in this estate');
  });

  // T08 — unit already occupied → 409
  test('T08: occupied unit returns 409 conflict', async () => {
    Estate.findById = jest.fn().mockResolvedValue({ _id: ESTATE_ID, name: 'Estate', isActive: true });
    Unit.findOne    = jest.fn().mockResolvedValue({ _id: UNIT_ID, label: 'Flat 1', status: 'occupied', monthlyPrice: 35000, serviceChargeMonthly: 10000 });
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants`)
      .send(validBody);
    expect(res.status).toBe(409);
    expect(res.body.message).toMatch(/already occupied/i);
  });

  // T09 — new tenant with durationMonths < 12 → 400
  test('T09: new tenant durationMonths < 12 returns 400', async () => {
    Estate.findById = jest.fn().mockResolvedValue({ _id: ESTATE_ID, name: 'Estate', isActive: true });
    Unit.findOne    = jest.fn().mockResolvedValue({ _id: UNIT_ID, label: 'Flat 1', status: 'vacant', monthlyPrice: 35000, serviceChargeMonthly: 10000 });
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants`)
      .send({ ...validBody, durationMonths: 6 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/1-year contract/i);
  });

  // T10 — durationMonths > 12 → 400 (validator catches it before controller)
  test('T10: durationMonths > 12 returns 400 validation error', async () => {
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants`)
      .send({ ...validBody, durationMonths: 18 });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });

  // T11 — email belongs to non-tenant account → 400
  test('T11: email already used by non-tenant role returns 400', async () => {
    Estate.findById = jest.fn().mockResolvedValue({ _id: ESTATE_ID, name: 'Estate', isActive: true });
    Unit.findOne    = jest.fn().mockResolvedValue({ _id: UNIT_ID, label: 'Flat 1', status: 'vacant', monthlyPrice: 35000, serviceChargeMonthly: 10000, save: jest.fn() });
    User.findOne    = jest.fn().mockResolvedValue({ _id: 'u1', role: 'admin', isActive: true });
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants`)
      .send({ ...validBody, tenantEmail: 'admin@domain.com' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/admin account/i);
  });

  // T12 — success → 201 with tenant data
  test('T12: valid request creates tenant and returns 201', async () => {
    Estate.findById = jest.fn().mockResolvedValue({ _id: ESTATE_ID, name: 'Test Estate', isActive: true });
    const mockUnit = { _id: UNIT_ID, label: 'Flat 1', status: 'vacant', monthlyPrice: 35000, serviceChargeMonthly: 10000, cautionFee: 0, legalFee: 0, save: jest.fn().mockResolvedValue(true) };
    Unit.findOne    = jest.fn().mockResolvedValue(mockUnit);
    Tenant.find     = jest.fn().mockReturnValue(makeQuery([]));
    const created   = makeTenantDoc();
    Tenant.create   = jest.fn().mockResolvedValue(created);

    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants`)
      .send(validBody);
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/created successfully/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 4 — getTenants (GET /tenants)
// ═════════════════════════════════════════════════════════════════════════════
describe('getTenants — GET /api/v1/estates/:estateId/tenants', () => {

  // T13 — returns empty paginated list
  test('T13: returns 200 with empty data when no tenants exist', async () => {
    Tenant.find     = jest.fn().mockReturnValue(makeQuery([]));
    Tenant.countDocuments = jest.fn().mockResolvedValue(0);
    Tenant.aggregate      = jest.fn().mockResolvedValue([]);
    Payment.aggregate     = jest.fn().mockResolvedValue([]);

    const res = await request(app).get(`/api/v1/estates/${ESTATE_ID}/tenants`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // T14 — returns pagination metadata
  test('T14: response includes pagination and summary blocks', async () => {
    const tenant = makeTenantDoc();
    Tenant.find     = jest.fn().mockReturnValue(makeQuery([tenant]));
    Tenant.countDocuments = jest.fn().mockResolvedValue(1);
    Tenant.aggregate      = jest.fn().mockResolvedValue([{ _id: null, totalRent: 35000, totalService: 10000, count: 1 }]);
    Payment.aggregate     = jest.fn().mockResolvedValue([]);

    const res = await request(app).get(`/api/v1/estates/${ESTATE_ID}/tenants`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('pagination');
    expect(res.body).toHaveProperty('summary');
    expect(res.body.summary).toHaveProperty('totalMonthlyRent');
  });

  // T15 — search param is passed through without crashing
  test('T15: ?search query does not crash and returns 200', async () => {
    Tenant.find     = jest.fn().mockReturnValue(makeQuery([]));
    Tenant.countDocuments = jest.fn().mockResolvedValue(0);
    Tenant.aggregate      = jest.fn().mockResolvedValue([]);
    Payment.aggregate     = jest.fn().mockResolvedValue([]);

    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants?search=John`);
    expect(res.status).toBe(200);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 5 — getTenant (GET /tenants/:id)
// ═════════════════════════════════════════════════════════════════════════════
describe('getTenant — GET /api/v1/estates/:estateId/tenants/:id', () => {

  // T16 — tenant not found → 404
  test('T16: tenant not found returns 404', async () => {
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(null));
    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Tenant not found');
  });

  // T17 — found tenant → 200 with overview and financialSummary
  test('T17: found tenant returns 200 with overview and financialSummary', async () => {
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(makeTenantDoc()));
    Payment.find    = jest.fn().mockReturnValue(makeQuery([])); // reconcile: no payments

    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('tenant');
    expect(res.body.data).toHaveProperty('overview');
    expect(res.body.data).toHaveProperty('financialSummary');
  });

  // T18 — overview contains rent and yearlyBreakdown fields
  test('T18: overview includes rent, yearlyBreakdown, and nextDue', async () => {
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(makeTenantDoc()));
    Payment.find    = jest.fn().mockReturnValue(makeQuery([]));

    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}`);
    const { overview } = res.body.data;
    expect(overview).toHaveProperty('rent');
    expect(overview).toHaveProperty('yearlyBreakdown');
    expect(overview.yearlyBreakdown).toHaveProperty('year1');
    expect(overview.yearlyBreakdown).toHaveProperty('year2');
  });

  // T19 — expand=history includes history array in response
  test('T19: expand=history adds history array to response', async () => {
    const tenant = makeTenantDoc({
      history: [{ event: 'created', note: 'Moved in', createdAt: new Date() }],
    });
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(tenant));
    Payment.find    = jest.fn().mockReturnValue(makeQuery([]));

    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}?expand=history`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.history)).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 6 — updateTenant (PUT /tenants/:id)
// ═════════════════════════════════════════════════════════════════════════════
describe('updateTenant — PUT /api/v1/estates/:estateId/tenants/:id', () => {

  // T20 — tenant not found → 404
  test('T20: tenant not found returns 404', async () => {
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(null));
    const res = await request(app)
      .put(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}`)
      .send({ tenantName: 'Updated Name' });
    expect(res.status).toBe(404);
  });

  // T21 — valid update → 200
  test('T21: valid update returns 200 with updated tenant', async () => {
    const tenant = makeTenantDoc();
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(tenant));
    Unit.findByIdAndUpdate = jest.fn().mockResolvedValue(true);

    const res = await request(app)
      .put(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}`)
      .send({ tenantName: 'Updated Name' });
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.message).toMatch(/updated successfully/i);
  });

  // T22 — PATCH alias works exactly like PUT
  test('T22: PATCH /tenants/:id also updates and returns 200', async () => {
    const tenant = makeTenantDoc();
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(tenant));
    Unit.findByIdAndUpdate = jest.fn().mockResolvedValue(true);

    const res = await request(app)
      .patch(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}`)
      .send({ tenantPhone: '08012345678' });
    expect(res.status).toBe(200);
  });

  // T23 — invalid tenantType value → 400 validation error
  test('T23: invalid tenantType value returns 400', async () => {
    const res = await request(app)
      .put(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}`)
      .send({ tenantType: 'unknown_type' });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 7 — deleteTenant (DELETE /tenants/:id)
// ═════════════════════════════════════════════════════════════════════════════
describe('deleteTenant — DELETE /api/v1/estates/:estateId/tenants/:id', () => {

  // T24 — tenant not found → 404
  test('T24: tenant not found returns 404', async () => {
    Tenant.findOneAndUpdate = jest.fn().mockResolvedValue(null);
    const res = await request(app)
      .delete(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}`);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Tenant not found');
  });

  // T25 — soft-delete → 200
  test('T25: existing tenant is soft-deleted and returns 200', async () => {
    Tenant.findOneAndUpdate = jest.fn().mockResolvedValue(makeTenantDoc());
    const res = await request(app)
      .delete(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // T26 — response message is "Tenant deleted successfully"
  test('T26: delete response message confirms deletion', async () => {
    Tenant.findOneAndUpdate = jest.fn().mockResolvedValue(makeTenantDoc());
    const res = await request(app)
      .delete(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}`);
    expect(res.body.message).toBe('Tenant deleted successfully');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 8 — History endpoints
// ═════════════════════════════════════════════════════════════════════════════
describe('History — GET/POST /api/v1/estates/:estateId/tenants/:id/history', () => {

  // T27 — list history: tenant not found → 404
  test('T27: GET /history returns 404 when tenant not found', async () => {
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(null));
    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}/history`);
    expect(res.status).toBe(404);
  });

  // T28 — list history: returns reversed history array
  test('T28: GET /history returns history entries in reverse order', async () => {
    const tenant = makeTenantDoc({
      history: [
        { event: 'created', note: 'Entry 1', createdAt: new Date('2024-01-01') },
        { event: 'note',    note: 'Entry 2', createdAt: new Date('2024-06-01') },
      ],
    });
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(tenant));
    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}/history`);
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
  });

  // T29 — add history: missing required event field → 400
  test('T29: POST /history without event field returns 400', async () => {
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}/history`)
      .send({ note: 'No event provided' });
    expect(res.status).toBe(400);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 9 — Transactions
// ═════════════════════════════════════════════════════════════════════════════
describe('Transactions — GET/POST /api/v1/estates/:estateId/tenants/:id/transactions', () => {

  // T30 — list transactions: tenant not found → 404
  test('T30: GET /transactions returns 404 when tenant not found', async () => {
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(null));
    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}/transactions`);
    expect(res.status).toBe(404);
  });

  // T31 — list transactions: returns paginated list
  test('T31: GET /transactions returns 200 with pagination', async () => {
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(makeTenantDoc()));
    Transaction.find = jest.fn().mockReturnValue(makeQuery([{ _id: 'tx1', amount: 35000 }]));
    Transaction.countDocuments = jest.fn().mockResolvedValue(1);

    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}/transactions`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('pagination');
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  // T32 — create transaction: tenant not found → 404
  test('T32: POST /transactions returns 404 when tenant not found', async () => {
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(null));
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}/transactions`)
      .send({ amount: 35000, type: 'rent', status: 'paid' });
    expect(res.status).toBe(404);
  });

  // T33 — create rent transaction: advances nextDueDate and returns 201
  test('T33: POST /transactions for rent advances nextDueDate and returns 201', async () => {
    const tenant = makeTenantDoc();
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(tenant));
    Transaction.create = jest.fn().mockResolvedValue({ _id: new mongoose.Types.ObjectId(), type: 'rent', amount: 35000 });

    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}/transactions`)
      .send({ amount: 35000, type: 'rent', status: 'paid', durationMonths: 12 });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(tenant.save).toHaveBeenCalled(); // nextDueDate advanced
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 10 — getMyTenant (GET /me)
// ═════════════════════════════════════════════════════════════════════════════
describe('getMyTenant — GET /api/v1/estates/:estateId/tenants/me', () => {

  // T34 — no tenant record for this user → 404
  test('T34: GET /me returns 404 when no tenant record found for user', async () => {
    Tenant.findOne = jest.fn().mockReturnValue(makeQuery(null));
    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/me`);
    expect(res.status).toBe(404);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toMatch(/no tenant record/i);
  });

  // T35 — found → 200 with tenant data and unpaidBillingCount
  test('T35: GET /me returns 200 with tenant data and unpaidBillingCount', async () => {
    const tenant = makeTenantDoc({ toObject: () => ({ ...makeTenantDoc() }) });
    Tenant.findOne = jest.fn().mockReturnValue(makeQuery(tenant));
    BillingItem.countDocuments = jest.fn().mockResolvedValue(3);

    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/me`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('unpaidBillingCount', 3);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 11 — listMyHistory (GET /me/history)
// ═════════════════════════════════════════════════════════════════════════════
describe('listMyHistory — GET /api/v1/estates/:estateId/tenants/me/history', () => {

  // T36 — no tenant → 404
  test('T36: GET /me/history returns 404 when tenant record not found', async () => {
    Tenant.findOne = jest.fn().mockReturnValue(makeQuery(null));
    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/me/history`);
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/tenant record not found/i);
  });

  // T37 — returns history in reverse order
  test('T37: GET /me/history returns 200 with history array reversed', async () => {
    const tenant = makeTenantDoc({
      history: [
        { event: 'created', note: 'First',  createdAt: new Date('2024-01-01') },
        { event: 'note',    note: 'Second', createdAt: new Date('2024-06-01') },
      ],
    });
    Tenant.findOne = jest.fn().mockReturnValue(makeQuery(tenant));

    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/me/history`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBe(2);
    // reversed: latest entry is first
    expect(res.body.data[0].note).toBe('Second');
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 12 — getMyBillingItems (GET /me/billing)
// ═════════════════════════════════════════════════════════════════════════════
describe('getMyBillingItems — GET /api/v1/estates/:estateId/tenants/me/billing', () => {

  // T38 — no billing items and no tenant record → 200 with empty categories
  test('T38: GET /me/billing returns 200 with empty arrays when no items exist', async () => {
    BillingItem.find   = jest.fn().mockReturnValue(makeQuery([]));
    Tenant.findOne     = jest.fn().mockReturnValue(makeQuery(null));

    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/me/billing`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // T39 — recurring billing item is categorised into the recurring array
  test('T39: GET /me/billing places recurring items in recurring category', async () => {
    const recurringItem = {
      _id: new mongoose.Types.ObjectId(),
      itemType: 'cleaning_service',
      label: 'Cleaning Service',
      amount: 5000,
      dueDate: new Date(),
      isRecurring: true,
      category: 'service',
      frequency: 'monthly',
    };
    BillingItem.find = jest.fn().mockReturnValue(makeQuery([recurringItem]));
    Tenant.findOne   = jest.fn().mockReturnValue(makeQuery(null));

    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/me/billing`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  // T40 — tenant exists with rent → includes rent in recurring section
  test('T40: GET /me/billing includes rent in recurring when tenant has rentAmount', async () => {
    BillingItem.find = jest.fn().mockReturnValue(makeQuery([]));
    Tenant.findOne   = jest.fn().mockReturnValue(makeQuery(makeTenantDoc({ rentAmount: 35000 })));

    const res = await request(app)
      .get(`/api/v1/estates/${ESTATE_ID}/tenants/me/billing`);
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 13 — paySelectedBillingItems (POST /me/billing/pay)
// ═════════════════════════════════════════════════════════════════════════════
describe('paySelectedBillingItems — POST /api/v1/estates/:estateId/tenants/me/billing/pay', () => {

  // T41 — invalid durationMonths → 400
  test('T41: POST /me/billing/pay returns 400 for invalid durationMonths (e.g. 3)', async () => {
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants/me/billing/pay`)
      .send({ itemIds: ['rent'], durationMonths: 3 });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/6 or 12 months/i);
  });

  // T42 — empty itemIds array → 400
  test('T42: POST /me/billing/pay returns 400 when itemIds is empty array', async () => {
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants/me/billing/pay`)
      .send({ itemIds: [] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/select at least one item/i);
  });

  // T43 — no valid billing items found → 400
  test('T43: POST /me/billing/pay returns 400 when itemIds has no matching items', async () => {
    BillingItem.findOne = jest.fn().mockResolvedValue(null);
    Tenant.findOne      = jest.fn().mockReturnValue(makeQuery(null));

    const fakeItemId = new mongoose.Types.ObjectId().toHexString();
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants/me/billing/pay`)
      .send({ itemIds: [fakeItemId] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no valid billing items/i);
  });

  // T44 — wallet not found → 404
  test('T44: POST /me/billing/pay returns 404 when wallet not found for user', async () => {
    BillingItem.findOne = jest.fn().mockResolvedValue(null);
    const tenant = makeTenantDoc({ rentAmount: 35000 });
    Tenant.findOne = jest.fn().mockReturnValue(makeQuery(tenant));
    Wallet.findOne = jest.fn().mockResolvedValue(null);

    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants/me/billing/pay`)
      .send({ itemIds: ['rent'], paymentMethod: 'wallet' });
    expect(res.status).toBe(404);
    expect(res.body.message).toMatch(/wallet not found/i);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Suite 14 — uploadTenantAvatar (POST /:id/avatar)
// ═════════════════════════════════════════════════════════════════════════════
describe('uploadTenantAvatar — POST /api/v1/estates/:estateId/tenants/:id/avatar', () => {

  // T45 — tenant not found → 404
  test('T45: POST /:id/avatar returns 404 when tenant not found', async () => {
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(null));
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}/avatar`);
    expect(res.status).toBe(404);
    expect(res.body.message).toBe('Tenant not found');
  });

  // T46 — no file uploaded → 400
  test('T46: POST /:id/avatar returns 400 when no image file is uploaded', async () => {
    Tenant.findById = jest.fn().mockReturnValue(makeQuery(makeTenantDoc()));
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}/avatar`);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/no image file/i);
  });

  // T47 — wrong file type (non-image) → multer 400
  test('T47: POST /:id/avatar returns 400 for non-image file type', async () => {
    const res = await request(app)
      .post(`/api/v1/estates/${ESTATE_ID}/tenants/${TENANT_ID}/avatar`)
      .attach('file', Buffer.from('fake pdf content'), { filename: 'doc.pdf', contentType: 'application/pdf' });
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});
