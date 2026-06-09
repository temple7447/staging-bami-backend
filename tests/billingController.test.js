/**
 * Billing Controller Tests
 *
 * 20 scenarios across createBillingItem, getBillingItems, updateBillingItem,
 * deleteBillingItem, and getBillingSummary (role/guard paths only).
 * All DB models are mocked — no connection required.
 */

// ─── Mocks ────────────────────────────────────────────────────────────────────

jest.mock('../models/BillingItem', () => ({
  findById: jest.fn(),
  find:     jest.fn(),
  create:   jest.fn(),
}));

jest.mock('../models/Tenant', () => ({
  findById:       jest.fn(),
  findOne:        jest.fn(),
  find:           jest.fn(),
  countDocuments: jest.fn(),
}));

jest.mock('../models/Estate', () => ({
  findById: jest.fn(),
}));

jest.mock('../models/Payment', () => ({
  find:   jest.fn(),
  exists: jest.fn(),
}));

jest.mock('../utils/slackService', () => ({
  sendActivityToSlack: jest.fn(),
}));

jest.mock('../utils/rentCalculator', () => ({
  getCurrentRent:      jest.fn((base) => base),
  calculateEffectiveRent: jest.fn((base, _s, months) => ({
    totalAmount: base * months,
    finalRent:   base,
  })),
}));

// ─── Load module under test ───────────────────────────────────────────────────

const BillingItem = require('../models/BillingItem');
const Tenant      = require('../models/Tenant');

const {
  createBillingItem,
  getBillingItems,
  updateBillingItem,
  deleteBillingItem,
  getBillingSummary,
} = require('../controllers/billingController');

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRes() {
  return {
    _status: null, _json: null,
    status(c) { this._status = c; return this; },
    json(d)   { this._json  = d; return this; },
  };
}

function makeReq(overrides = {}) {
  return {
    params: {}, query: {}, body: {},
    user: { _id: 'adminId', id: 'adminId', name: 'Admin', role: 'super_admin' },
    ...overrides,
  };
}

// ─── Suite 1: createBillingItem ───────────────────────────────────────────────

describe('createBillingItem', () => {

  test('S01: 404 when tenant not found', async () => {
    Tenant.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(null) });
    const req = makeReq({ params: { tenantId: 'tid' }, body: { label: 'Utility', amount: 5000 } });
    const res = makeRes();
    await createBillingItem(req, res);
    expect(res._status).toBe(404);
    expect(res._json.message).toMatch(/tenant not found/i);
  });

  test('S02: 404 when tenant is inactive', async () => {
    Tenant.findById.mockReturnValue({
      populate: jest.fn().mockResolvedValue({ _id: 'tid', isActive: false }),
    });
    const req = makeReq({ params: { tenantId: 'tid' }, body: {} });
    const res = makeRes();
    await createBillingItem(req, res);
    expect(res._status).toBe(404);
  });

  test('S03: 201 on success with correct response shape', async () => {
    const mockTenant = { _id: 'tid', isActive: true, tenantName: 'Jane', user: 'uid', estate: { _id: 'eid' } };
    const mockItem   = { _id: 'bid', label: 'Utility', amount: 5000, itemType: 'utility', dueDate: new Date() };
    Tenant.findById.mockReturnValue({ populate: jest.fn().mockResolvedValue(mockTenant) });
    BillingItem.create.mockResolvedValue(mockItem);
    const req = makeReq({ params: { tenantId: 'tid' }, body: { itemType: 'utility', label: 'Utility', amount: 5000, dueDate: new Date() } });
    const res = makeRes();
    await createBillingItem(req, res);
    expect(res._status).toBe(201);
    expect(res._json.success).toBe(true);
    expect(res._json.data._id).toBe('bid');
  });

  test('S04: 500 on unexpected database error', async () => {
    Tenant.findById.mockReturnValue({ populate: jest.fn().mockRejectedValue(new Error('DB crash')) });
    const req = makeReq({ params: { tenantId: 'tid' }, body: {} });
    const res = makeRes();
    await createBillingItem(req, res);
    expect(res._status).toBe(500);
  });

});

// ─── Suite 2: getBillingItems ─────────────────────────────────────────────────

describe('getBillingItems', () => {

  test('S05: 404 when tenant not found', async () => {
    Tenant.findById.mockResolvedValue(null);
    const req = makeReq({ params: { tenantId: 'tid' } });
    const res = makeRes();
    await getBillingItems(req, res);
    expect(res._status).toBe(404);
  });

  test('S06: 200 returns array of billing items', async () => {
    Tenant.findById.mockResolvedValue({ _id: 'tid', isActive: true });
    BillingItem.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue([{ _id: 'b1' }, { _id: 'b2' }]),
        }),
      }),
    });
    const req = makeReq({ params: { tenantId: 'tid' }, query: {} });
    const res = makeRes();
    await getBillingItems(req, res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
    expect(res._json.data).toHaveLength(2);
  });

  test('S07: response count matches the number of items returned', async () => {
    Tenant.findById.mockResolvedValue({ _id: 'tid', isActive: true });
    BillingItem.find.mockReturnValue({
      sort: jest.fn().mockReturnValue({
        populate: jest.fn().mockReturnValue({
          populate: jest.fn().mockResolvedValue([{ _id: 'b1' }]),
        }),
      }),
    });
    const req = makeReq({ params: { tenantId: 'tid' }, query: {} });
    const res = makeRes();
    await getBillingItems(req, res);
    expect(res._json.count).toBe(1);
  });

  test('S08: 500 on unexpected error', async () => {
    Tenant.findById.mockRejectedValue(new Error('DB fail'));
    const req = makeReq({ params: { tenantId: 'tid' }, query: {} });
    const res = makeRes();
    await getBillingItems(req, res);
    expect(res._status).toBe(500);
  });

});

// ─── Suite 3: updateBillingItem ───────────────────────────────────────────────

describe('updateBillingItem', () => {

  test('S09: 404 when billing item not found', async () => {
    BillingItem.findById.mockResolvedValue(null);
    const req = makeReq({ params: { itemId: 'bid' }, body: { label: 'New' } });
    const res = makeRes();
    await updateBillingItem(req, res);
    expect(res._status).toBe(404);
    expect(res._json.message).toMatch(/billing item not found/i);
  });

  test('S10: 400 when billing item is already paid', async () => {
    BillingItem.findById.mockResolvedValue({ _id: 'bid', isActive: true, isPaid: true });
    const req = makeReq({ params: { itemId: 'bid' }, body: { label: 'New' } });
    const res = makeRes();
    await updateBillingItem(req, res);
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/cannot update a paid/i);
  });

  test('S11: 200 on successful update', async () => {
    const mockItem = {
      _id: 'bid', isActive: true, isPaid: false, label: 'Old',
      save: jest.fn().mockResolvedValue(true),
    };
    BillingItem.findById.mockResolvedValue(mockItem);
    const req = makeReq({ params: { itemId: 'bid' }, body: { label: 'Updated Label' } });
    const res = makeRes();
    await updateBillingItem(req, res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
  });

  test('S12: sets updatedBy to req.user.id on update', async () => {
    const mockItem = {
      _id: 'bid', isActive: true, isPaid: false,
      save: jest.fn().mockResolvedValue(true),
    };
    BillingItem.findById.mockResolvedValue(mockItem);
    const req = makeReq({ params: { itemId: 'bid' }, body: { label: 'X' } });
    const res = makeRes();
    await updateBillingItem(req, res);
    expect(mockItem.updatedBy).toBe('adminId');
  });

});

// ─── Suite 4: deleteBillingItem ───────────────────────────────────────────────

describe('deleteBillingItem', () => {

  test('S13: 404 when billing item not found', async () => {
    BillingItem.findById.mockResolvedValue(null);
    const req = makeReq({ params: { itemId: 'bid' } });
    const res = makeRes();
    await deleteBillingItem(req, res);
    expect(res._status).toBe(404);
    expect(res._json.message).toMatch(/billing item not found/i);
  });

  test('S14: 400 when billing item is already paid', async () => {
    BillingItem.findById.mockResolvedValue({ _id: 'bid', isActive: true, isPaid: true });
    const req = makeReq({ params: { itemId: 'bid' } });
    const res = makeRes();
    await deleteBillingItem(req, res);
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/cannot delete a paid/i);
  });

  test('S15: 200 on successful soft delete', async () => {
    const mockItem = {
      _id: 'bid', isActive: true, isPaid: false,
      save: jest.fn().mockResolvedValue(true),
    };
    BillingItem.findById.mockResolvedValue(mockItem);
    const req = makeReq({ params: { itemId: 'bid' } });
    const res = makeRes();
    await deleteBillingItem(req, res);
    expect(res._status).toBe(200);
    expect(res._json.success).toBe(true);
  });

  test('S16: sets isActive = false on soft delete', async () => {
    const mockItem = {
      _id: 'bid', isActive: true, isPaid: false,
      save: jest.fn().mockResolvedValue(true),
    };
    BillingItem.findById.mockResolvedValue(mockItem);
    const req = makeReq({ params: { itemId: 'bid' } });
    const res = makeRes();
    await deleteBillingItem(req, res);
    expect(mockItem.isActive).toBe(false);
  });

});

// ─── Suite 5: getBillingSummary — role / guard paths ─────────────────────────

describe('getBillingSummary — guards', () => {

  test('S17: 404 when tenant role has no active tenant profile', async () => {
    Tenant.findOne.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      }),
    });
    const req = makeReq({ user: { id: 'uid', role: 'tenant' }, query: {} });
    const res = makeRes();
    await getBillingSummary(req, res);
    expect(res._status).toBe(404);
    expect(res._json.message).toMatch(/no active tenant profile/i);
  });

  test('S18: 403 for unrecognised role', async () => {
    const req = makeReq({ user: { id: 'uid', role: 'unknown_role' }, query: {} });
    const res = makeRes();
    await getBillingSummary(req, res);
    expect(res._status).toBe(403);
    expect(res._json.message).toMatch(/access denied/i);
  });

  test('S19: 400 when admin has no assigned estates and no estateId', async () => {
    const req = makeReq({
      user: { id: 'uid', role: 'admin', assignedEstates: [] },
      query: {},
    });
    const res = makeRes();
    await getBillingSummary(req, res);
    expect(res._status).toBe(400);
    expect(res._json.message).toMatch(/no estates assigned/i);
  });

  test('S20: 404 when super_admin + tenantId but tenant does not exist', async () => {
    Tenant.findOne.mockReturnValue({
      populate: jest.fn().mockReturnValue({
        populate: jest.fn().mockResolvedValue(null),
      }),
    });
    const req = makeReq({
      user: { id: 'uid', role: 'super_admin' },
      query: { tenantId: 'tid' },
    });
    const res = makeRes();
    await getBillingSummary(req, res);
    expect(res._status).toBe(404);
    expect(res._json.message).toMatch(/tenant not found/i);
  });

});
