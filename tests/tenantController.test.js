/**
 * Tenant Controller Tests
 *
 * 42 scenarios across: reconcileNextDueDate, createTenant, getTenant,
 * updateTenant, deleteTenant, addHistory, listHistory, listTransactions,
 * paySelectedBillingItems, getMyTenant, listMyHistory, listBillingItems.
 *
 * All Mongoose models are mocked — no DB connection required.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('express-validator', () => ({
  validationResult: jest.fn(() => ({ isEmpty: () => true, array: () => [] })),
}));

jest.mock('../models/Tenant', () => ({
  findById: jest.fn(),
  findOne: jest.fn(),
  find: jest.fn(),
  findOneAndUpdate: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  create: jest.fn(),
  countDocuments: jest.fn(),
  aggregate: jest.fn(),
  updateMany: jest.fn(),
}));

jest.mock('../models/Estate', () => ({
  findById: jest.fn(),
}));

jest.mock('../models/Unit', () => ({
  findOne: jest.fn(),
  findByIdAndUpdate: jest.fn(),
}));

jest.mock('../models/Transaction', () => ({
  find: jest.fn(),
  create: jest.fn(),
  countDocuments: jest.fn(),
}));

jest.mock('../models/Payment', () => ({
  find: jest.fn(),
  exists: jest.fn(),
  countDocuments: jest.fn(),
  create: jest.fn(),
  aggregate: jest.fn(),
}));

jest.mock('../models/BillingItem', () => ({
  find: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  countDocuments: jest.fn(),
}));

jest.mock('../models/User', () => ({
  findOne: jest.fn(),
  findById: jest.fn(),
  findByIdAndUpdate: jest.fn(),
  create: jest.fn(),
  updateMany: jest.fn(),
}));

jest.mock('../models/Wallet', () => ({
  findOne: jest.fn(),
}));

jest.mock('../utils/emailService', () => ({
  sendTenantWelcomeEmail: jest.fn(),
  sendReceiptEmail: jest.fn(),
}));

jest.mock('../utils/slackService', () => ({
  sendActivityToSlack: jest.fn(),
}));

jest.mock('../utils/distributionService', () => ({
  distributePayment: jest.fn().mockResolvedValue({}),
}));

jest.mock('../utils/logger', () => ({
  logError: jest.fn().mockReturnValue({}),
  logInfo: jest.fn(),
  logWarning: jest.fn(),
}));

jest.mock('../config/cloudinary', () => ({
  cloudinary: { uploader: { destroy: jest.fn(), upload_stream: jest.fn() } },
  ensureCloudinaryConfigured: jest.fn(),
}));

jest.mock('../utils/rentCalculator', () => ({
  RULE_START_DATE: new Date('2024-01-01'),
  getCurrentRent: jest.fn((base) => base),
  calculateEffectiveRent: jest.fn((base, _start, months) => ({
    totalAmount: base * months,
    finalRent: base,
  })),
}));

jest.mock('../controllers/paymentController', () => ({
  calculateReceiptData: jest.fn().mockResolvedValue({}),
}));

// ─── Load modules under test ──────────────────────────────────────────────────

const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const Unit = require('../models/Unit');
const Transaction = require('../models/Transaction');
const Payment = require('../models/Payment');
const BillingItem = require('../models/BillingItem');
const User = require('../models/User');
const Wallet = require('../models/Wallet');
const { validationResult } = require('express-validator');

const {
  createTenant,
  getTenant,
  updateTenant,
  deleteTenant,
  addHistory,
  listHistory,
  listTransactions,
  listBillingItems,
  getMyTenant,
  listMyHistory,
  paySelectedBillingItems,
  reconcileNextDueDate,
} = require('../controllers/tenantController');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRes() {
  return {
    _status: null,
    _json: null,
    status(code) { this._status = code; return this; },
    json(data)   { this._json  = data; return this; },
  };
}

function makeReq(overrides = {}) {
  return {
    params: {},
    query:  {},
    body:   {},
    user: { _id: 'userId', id: 'userId', role: 'admin', name: 'Test Admin' },
    ...overrides,
  };
}

/** Chainable Payment mock for reconcileNextDueDate */
function makePaymentModel(payments = []) {
  return {
    find: jest.fn().mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue(payments),
      }),
    }),
  };
}

/** Sets up a populated tenant for paySelectedBillingItems tests */
function setupTenantForPayment() {
  const mockTenant = {
    _id: 'tid', isActive: true, rentAmount: 100000, baseRent2024: 100000,
    entryDate: new Date('2024-01-15'),
    lastRentIncreaseDate: new Date('2024-01-15'),
    nextDueDate: new Date('2025-01-15'),
    rentOutstanding: 0, serviceChargeOutstanding: 0,
    unit: { _id: 'uid', serviceChargeMonthly: 5000, cautionFee: 50000, legalFee: 50000 },
    estate: { _id: 'eid', name: 'Test Estate' },
    history: [],
    save: jest.fn().mockResolvedValue(true),
  };
  BillingItem.find.mockReturnValue({ sort: jest.fn().mockResolvedValue([]) });
  Tenant.findOne.mockReturnValue({
    populate: jest.fn().mockReturnValue({
      populate: jest.fn().mockResolvedValue(mockTenant),
    }),
  });
  return mockTenant;
}

// ─── Suite 1: reconcileNextDueDate ────────────────────────────────────────────

describe('reconcileNextDueDate', () => {
  beforeEach(() => {
    Tenant.findByIdAndUpdate.mockResolvedValue({});
  });

  test('S01: returns null when tenant has no entryDate', async () => {
    const tenant = { _id: 'tid', nextDueDate: new Date() };
    const result = await reconcileNextDueDate(tenant, makePaymentModel());
    expect(result).toBeNull();
  });

  test('S02: returns null when no payments and stored date equals entryDate', async () => {
    const entryDate = new Date('2024-01-15');
    const tenant = { _id: 'tid', entryDate, nextDueDate: new Date(Date.UTC(2024, 0, 15)) };
    const result = await reconcileNextDueDate(tenant, makePaymentModel());
    expect(result).toBeNull();
  });

  test('S03: advances by 12 months (default) for a single rent payment without metadata', async () => {
    const entryDate = new Date('2024-01-15');
    const tenant = { _id: 'tid', entryDate, nextDueDate: entryDate };
    const payments = [{ paymentType: 'rent', paystackResponse: {} }];
    const result = await reconcileNextDueDate(tenant, makePaymentModel(payments));
    expect(result).not.toBeNull();
    expect(result.getUTCFullYear()).toBe(2025);
    expect(result.getUTCMonth()).toBe(0); // January
  });

  test('S04: respects explicit duration_months in payment metadata', async () => {
    const entryDate = new Date('2024-01-15');
    const tenant = { _id: 'tid', entryDate, nextDueDate: entryDate };
    const payments = [{
      paymentType: 'rent',
      paystackResponse: { data: { metadata: { duration_months: 6, billing_items: [] } } },
    }];
    const result = await reconcileNextDueDate(tenant, makePaymentModel(payments));
    expect(result).not.toBeNull();
    expect(result.getUTCFullYear()).toBe(2024);
    expect(result.getUTCMonth()).toBe(6); // July
  });

  test('S05: accumulates multiple rent payments correctly', async () => {
    const entryDate = new Date('2024-01-15');
    const tenant = { _id: 'tid', entryDate, nextDueDate: entryDate };
    const payments = [
      { paymentType: 'rent', paystackResponse: {} },
      { paymentType: 'rent', paystackResponse: {} },
    ];
    const result = await reconcileNextDueDate(tenant, makePaymentModel(payments));
    expect(result).not.toBeNull();
    expect(result.getUTCFullYear()).toBe(2026);
  });

  test('S06: returns null when computed date already matches stored date', async () => {
    const entryDate = new Date('2024-01-15');
    const stored = new Date(Date.UTC(2025, 0, 15)); // entry + 12 months
    const tenant = { _id: 'tid', entryDate, nextDueDate: stored };
    const payments = [{ paymentType: 'rent', paystackResponse: {} }];
    const result = await reconcileNextDueDate(tenant, makePaymentModel(payments));
    expect(result).toBeNull();
  });
});

// ─── Suite 2: createTenant — validation guards ────────────────────────────────

describe('createTenant — validation guards', () => {
  test('S07: 404 when estate not found', async () => {
    Estate.findById.mockResolvedValue(null);
    const req = makeReq({ params: { estateId: 'eid' }, body: { unitId: 'uid' } });
    const res = makeRes();
    await createTenant(req, res);
    expect(res._status).toBe(404);
    expect(res._json.message).toMatch(/estate not found/i);
  });

  test('S08: 404 when estate is inactive', async () => {
    Estate.findById.mockResolvedValue({ isActive: false });
    const req = makeReq({ params: { estateId: 'eid' }, body: { unitId: 'uid' } });
    const res = makeRes();
    await createTenant(req, res);
    expect(res._status).toBe(404);
  });

  test('S09: 400 when no unitId in request body', async () => {
    Estate.findById.mockResolvedValue({ isActive: true, name: 'Test Estate' });
    const req = makeReq({ params: { estateId: 'eid' }, body: { tenantName: 'Jane' } });
    const res = makeRes();
    await createTenant(req, res);
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/unit id/i);
  });

  test('S10: 404 when unit not found in estate', async () => {
    Estate.findById.mockResolvedValue({ isActive: true, name: 'Test Estate' });
    Unit.findOne.mockResolvedValue(null);
    const req = makeReq({ params: { estateId: 'eid' }, body: { unitId: 'uid', tenantName: 'Jane' } });
    const res = makeRes();
    await createTenant(req, res);
    expect(res._status).toBe(404);
    expect(res._json.message).toMatch(/unit not found/i);
  });

  test('S11: 409 when unit is already occupied', async () => {
    Estate.findById.mockResolvedValue({ isActive: true, name: 'Test Estate' });
    Unit.findOne.mockResolvedValue({ _id: 'uid', status: 'occupied', label: 'A1' });
    const req = makeReq({ params: { estateId: 'eid' }, body: { unitId: 'uid', tenantName: 'Jane' } });
    const res = makeRes();
    await createTenant(req, res);
    expect(res._status).toBe(409);
    expect(res._json.message).toMatch(/already occupied/i);
  });

  test('S12: 400 for new tenant with durationMonths < 12', async () => {
    Estate.findById.mockResolvedValue({ isActive: true, name: 'Test Estate' });
    Unit.findOne.mockResolvedValue({ _id: 'uid', status: 'vacant', label: 'A1' });
    const req = makeReq({
      params: { estateId: 'eid' },
      body: { unitId: 'uid', tenantName: 'Jane', tenantType: 'new', durationMonths: 6 },
    });
    const res = makeRes();
    await createTenant(req, res);
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/1-year contract/i);
  });

  test('S13: 400 when durationMonths > 12', async () => {
    Estate.findById.mockResolvedValue({ isActive: true, name: 'Test Estate' });
    Unit.findOne.mockResolvedValue({ _id: 'uid', status: 'vacant', label: 'A1' });
    const req = makeReq({
      params: { estateId: 'eid' },
      body: { unitId: 'uid', tenantName: 'Jane', tenantType: 'new', durationMonths: 13 },
    });
    const res = makeRes();
    await createTenant(req, res);
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/more than 12 months/i);
  });
});

// ─── Suite 3: getTenant — not-found paths ─────────────────────────────────────

describe('getTenant — not-found paths', () => {
  test('S14: 404 when tenant does not exist', async () => {
    Tenant.findById.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      }),
    });
    const req = makeReq({ params: { id: 'tid' }, query: {} });
    const res = makeRes();
    await getTenant(req, res);
    expect(res._status).toBe(404);
    expect(res._json.success).toBe(false);
  });

  test('S15: 404 when tenant.isActive is false', async () => {
    Tenant.findById.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue({ _id: 'tid', isActive: false }),
      }),
    });
    const req = makeReq({ params: { id: 'tid' }, query: {} });
    const res = makeRes();
    await getTenant(req, res);
    expect(res._status).toBe(404);
  });

  test('S16: 404 on CastError', async () => {
    const castErr = Object.assign(new Error('cast'), { name: 'CastError' });
    Tenant.findById.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockRejectedValue(castErr),
      }),
    });
    const req = makeReq({ params: { id: 'bad-id' }, query: {} });
    const res = makeRes();
    await getTenant(req, res);
    expect(res._status).toBe(404);
  });
});

// ─── Suite 4: updateTenant ────────────────────────────────────────────────────

describe('updateTenant', () => {
  test('S17: 404 when tenant not found', async () => {
    Tenant.findById.mockResolvedValue(null);
    const req = makeReq({ params: { id: 'tid' }, body: { tenantName: 'New Name' } });
    const res = makeRes();
    await updateTenant(req, res);
    expect(res._status).toBe(404);
  });

  test('S18: 400 on duplicate key error (code 11000)', async () => {
    const mockTenant = {
      _id: 'tid', isActive: true, tenantName: 'Old', rentAmount: 1000,
      serviceChargeAmount: 500, tenantType: 'new', status: 'occupied',
      unitLabel: 'A1', unit: 'uid', history: [], createdBy: 'cuid',
      save: jest.fn().mockRejectedValue(Object.assign(new Error('dup'), { code: 11000 })),
    };
    Tenant.findById.mockResolvedValue(mockTenant);
    const req = makeReq({ params: { id: 'tid' }, body: { tenantName: 'New Name' } });
    const res = makeRes();
    await updateTenant(req, res);
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/already exists/i);
  });

  test('S19: 404 on CastError during findById', async () => {
    const castErr = Object.assign(new Error('cast'), { name: 'CastError' });
    Tenant.findById.mockRejectedValue(castErr);
    const req = makeReq({ params: { id: 'bad-id' }, body: {} });
    const res = makeRes();
    await updateTenant(req, res);
    expect(res._status).toBe(404);
  });

  test('S20: 400 on ValidationError during save', async () => {
    const mockTenant = {
      _id: 'tid', isActive: true, tenantName: 'Old', rentAmount: 1000,
      serviceChargeAmount: 500, tenantType: 'new', status: 'occupied',
      unitLabel: 'A1', unit: 'uid', history: [], createdBy: 'cuid',
      save: jest.fn().mockRejectedValue(Object.assign(new Error('val error'), { name: 'ValidationError' })),
    };
    Tenant.findById.mockResolvedValue(mockTenant);
    const req = makeReq({ params: { id: 'tid' }, body: { tenantName: 'New' } });
    const res = makeRes();
    await updateTenant(req, res);
    expect(res._status).toBe(400);
  });
});

// ─── Suite 5: deleteTenant ────────────────────────────────────────────────────

describe('deleteTenant', () => {
  test('S21: 404 when tenant not found', async () => {
    Tenant.findOneAndUpdate.mockResolvedValue(null);
    const req = makeReq({ params: { id: 'tid' } });
    const res = makeRes();
    await deleteTenant(req, res);
    expect(res._status).toBe(404);
    expect(res._json.message).toMatch(/tenant not found/i);
  });

  test('S22: 200 on successful soft delete', async () => {
    Tenant.findOneAndUpdate.mockResolvedValue({ _id: 'tid', user: null });
    const req = makeReq({ params: { id: 'tid' } });
    const res = makeRes();
    await deleteTenant(req, res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
  });

  test('S23: deactivates linked user account when tenant has a user', async () => {
    Tenant.findOneAndUpdate.mockResolvedValue({ _id: 'tid', user: 'linkedUserId' });
    User.findByIdAndUpdate.mockResolvedValue({});
    const req = makeReq({ params: { id: 'tid' } });
    const res = makeRes();
    await deleteTenant(req, res);
    expect(User.findByIdAndUpdate).toHaveBeenCalledWith('linkedUserId', { isActive: false });
  });
});

// ─── Suite 6: addHistory ──────────────────────────────────────────────────────

describe('addHistory', () => {
  test('S24: 404 when tenant not found', async () => {
    Tenant.findById.mockResolvedValue(null);
    const req = makeReq({ params: { id: 'tid' }, body: { event: 'note', note: 'Hello' } });
    const res = makeRes();
    await addHistory(req, res);
    expect(res._status).toBe(404);
  });

  test('S25: 201 on success with correct response shape', async () => {
    const mockHistory = [];
    const mockTenant = {
      _id: 'tid', isActive: true,
      history: mockHistory,
      save: jest.fn().mockResolvedValue(true),
    };
    Tenant.findById.mockResolvedValue(mockTenant);
    const req = makeReq({ params: { id: 'tid' }, body: { event: 'note', note: 'Test note', meta: {} } });
    const res = makeRes();
    await addHistory(req, res);
    expect(res._status).toBe(201);
    expect(res._json.success).toBe(true);
    expect(mockHistory).toHaveLength(1);
    expect(mockHistory[0].event).toBe('note');
  });

  test('S26: 400 when validation fails', async () => {
    validationResult.mockReturnValueOnce({
      isEmpty: () => false,
      array: () => [{ msg: 'event is required' }],
    });
    const req = makeReq({ params: { id: 'tid' }, body: {} });
    const res = makeRes();
    await addHistory(req, res);
    expect(res._status).toBe(400);
    expect(res._json.success).toBe(false);
  });
});

// ─── Suite 7: listHistory ─────────────────────────────────────────────────────

describe('listHistory', () => {
  test('S27: 404 when tenant not found', async () => {
    Tenant.findById.mockResolvedValue(null);
    const req = makeReq({ params: { id: 'tid' } });
    const res = makeRes();
    await listHistory(req, res);
    expect(res._status).toBe(404);
  });

  test('S28: returns history in reverse chronological order', async () => {
    const mockTenant = {
      _id: 'tid', isActive: true,
      history: [{ event: 'created', note: 'first' }, { event: 'payment', note: 'second' }],
    };
    Tenant.findById.mockResolvedValue(mockTenant);
    const req = makeReq({ params: { id: 'tid' } });
    const res = makeRes();
    await listHistory(req, res);
    expect(res._status).toBe(200);
    expect(res._json.data[0].event).toBe('payment');  // most recent first
    expect(res._json.data[1].event).toBe('created');
  });
});

// ─── Suite 8: listTransactions ────────────────────────────────────────────────

describe('listTransactions', () => {
  test('S29: 404 when tenant not found', async () => {
    Tenant.findById.mockResolvedValue(null);
    const req = makeReq({ params: { id: 'tid' }, query: {} });
    const res = makeRes();
    await listTransactions(req, res);
    expect(res._status).toBe(404);
  });

  test('S30: returns paginated results with correct shape', async () => {
    Tenant.findById.mockResolvedValue({ _id: 'tid', isActive: true });
    Transaction.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        skip: jest.fn().mockReturnValue({
          limit: jest.fn().mockResolvedValue([{ _id: 'tx1', amount: 5000 }]),
        }),
      }),
    });
    Transaction.countDocuments.mockResolvedValue(1);
    const req = makeReq({ params: { id: 'tid' }, query: { page: '1', limit: '20' } });
    const res = makeRes();
    await listTransactions(req, res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    expect(res._json.data).toHaveLength(1);
    expect(res._json.pagination.totalItems).toBe(1);
  });
});

// ─── Suite 9: paySelectedBillingItems — guards ────────────────────────────────

describe('paySelectedBillingItems — guards', () => {
  test('S31: 400 when durationMonths is not 6 or 12', async () => {
    const req = makeReq({ body: { itemIds: ['rent'], durationMonths: 3 } });
    const res = makeRes();
    await paySelectedBillingItems(req, res);
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/6 or 12 months/i);
  });

  test('S32: 400 when items array is empty', async () => {
    const req = makeReq({ body: { itemIds: [], durationMonths: 12 } });
    const res = makeRes();
    await paySelectedBillingItems(req, res);
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/select at least one/i);
  });

  test('S33: 404 when wallet not found', async () => {
    setupTenantForPayment();
    Wallet.findOne.mockResolvedValue(null);
    const req = makeReq({ body: { itemIds: ['rent'], durationMonths: 12, paymentMethod: 'wallet' } });
    const res = makeRes();
    await paySelectedBillingItems(req, res);
    expect(res._status).toBe(404);
    expect(res._json.message).toMatch(/wallet not found/i);
  });

  test('S34: 400 when wallet balance is insufficient', async () => {
    setupTenantForPayment();
    Wallet.findOne.mockResolvedValue({ balance: 1000, totalSpent: 0 });
    const req = makeReq({ body: { itemIds: ['rent'], durationMonths: 12, paymentMethod: 'wallet' } });
    const res = makeRes();
    await paySelectedBillingItems(req, res);
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/insufficient/i);
  });

  test('S35: 400 for non-wallet payment method', async () => {
    setupTenantForPayment();
    const req = makeReq({ body: { itemIds: ['rent'], durationMonths: 12, paymentMethod: 'bank' } });
    const res = makeRes();
    await paySelectedBillingItems(req, res);
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/wallet/i);
  });
});

// ─── Suite 10: getMyTenant ────────────────────────────────────────────────────

describe('getMyTenant', () => {
  test('S36: 404 when no tenant record for this user', async () => {
    Tenant.findOne.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      }),
    });
    const req = makeReq();
    const res = makeRes();
    await getMyTenant(req, res);
    expect(res._status).toBe(404);
    expect(res._json.message).toMatch(/no tenant record/i);
  });

  test('S37: 200 includes unpaidBillingCount in response data', async () => {
    const entryDate = new Date('2024-01-15');
    const mockTenant = {
      _id: 'tid', isActive: true, tenantName: 'Jane', user: 'userId',
      entryDate,
      nextDueDate: new Date(Date.UTC(2024, 0, 15)),
      history: [],
      toObject: jest.fn().mockReturnValue({ _id: 'tid', tenantName: 'Jane' }),
    };
    Tenant.findOne.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(mockTenant),
      }),
    });
    Payment.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        lean: jest.fn().mockResolvedValue([]),
      }),
    });
    Tenant.findByIdAndUpdate.mockResolvedValue({});
    BillingItem.countDocuments.mockResolvedValue(3);

    const req = makeReq();
    const res = makeRes();
    await getMyTenant(req, res);
    expect(res._status).toBe(200);
    expect(res._json.data.unpaidBillingCount).toBe(3);
  });
});

// ─── Suite 11: listMyHistory ──────────────────────────────────────────────────

describe('listMyHistory', () => {
  test('S38: 404 when no tenant found for this user', async () => {
    Tenant.findOne.mockResolvedValue(null);
    const req = makeReq();
    const res = makeRes();
    await listMyHistory(req, res);
    expect(res._status).toBe(404);
    expect(res._json.message).toMatch(/tenant record not found/i);
  });

  test('S39: returns history in reverse order', async () => {
    const mockTenant = {
      _id: 'tid', isActive: true,
      history: [{ event: 'created', note: 'a' }, { event: 'payment', note: 'b' }],
    };
    Tenant.findOne.mockResolvedValue(mockTenant);
    const req = makeReq();
    const res = makeRes();
    await listMyHistory(req, res);
    expect(res._status).toBe(200);
    expect(res._json.data[0].event).toBe('payment');
    expect(res._json.data[1].event).toBe('created');
  });
});

// ─── Suite 12: listBillingItems ───────────────────────────────────────────────

describe('listBillingItems', () => {
  test('S40: 404 when tenant not found', async () => {
    Tenant.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(null),
    });
    const req = makeReq({ params: { id: 'tid' } });
    const res = makeRes();
    await listBillingItems(req, res);
    expect(res._status).toBe(404);
  });

  test('S41: 400 when tenant has no linked unit', async () => {
    Tenant.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue({ _id: 'tid', isActive: true, unit: null }),
    });
    const req = makeReq({ params: { id: 'tid' } });
    const res = makeRes();
    await listBillingItems(req, res);
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/not assigned to any unit/i);
  });

  test('S42: 200 returns rent, service charge, caution fee, legal fee for new tenant', async () => {
    const mockUnit = { label: 'A1', serviceChargeMonthly: 5000, cautionFee: 50000, legalFee: 50000 };
    const mockTenant = {
      _id: 'tid', isActive: true, tenantName: 'Jane', tenantType: 'new',
      rentAmount: 100000, unit: mockUnit,
    };
    Tenant.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue(mockTenant),
    });
    Payment.exists.mockResolvedValue(null); // caution and legal not yet paid

    const req = makeReq({ params: { id: 'tid' } });
    const res = makeRes();
    await listBillingItems(req, res);
    expect(res._status).toBe(200);
    const items = res._json.data.items;
    const codes = items.map(i => i.code);
    expect(codes).toContain('rent');
    expect(codes).toContain('service_charge');
    expect(codes).toContain('caution_fee');
    expect(codes).toContain('legal_fee');
    expect(items).toHaveLength(4);
  });
});
