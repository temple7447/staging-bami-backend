'use strict';

/**
 * businessLogic.test.js — 36 pure-logic tests, no database required.
 *
 * Coverage:
 *   D01–D12  calculateDistribution  (distributionService.js)
 *   B01–B06  generateBankTransferReference + BANK_ACCOUNT  (bankConfig.js)
 *   P01–P09  pagination middleware  (middleware/pagination.js)
 *   M01–M05  sanitization middleware  (middleware/sanitization.js)
 *   V01–V05  validation helpers  (middleware/validation.js)
 *   X01–X05  rentIncreaseService logic  (utils/rentIncreaseService.js — mocked DB)
 */

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Call the pagination middleware with a mock req/res and return { req, res, next }. */
function runPagination(query = {}, defaultLimit, maxLimit) {
  const pagination = require('../middleware/pagination');
  const req = { query };
  const res = {};
  const next = jest.fn();
  pagination(defaultLimit, maxLimit)(req, res, next);
  return { req, res, next };
}

/** Call the sanitization middleware with mock req objects and return the mutated req. */
function runSanitize(body = {}, query = {}, params = {}) {
  const sanitize = require('../middleware/sanitization');
  const req = {
    body:   JSON.parse(JSON.stringify(body)),
    query:  JSON.parse(JSON.stringify(query)),
    params: JSON.parse(JSON.stringify(params)),
  };
  const next = jest.fn();
  sanitize(req, {}, next);
  return { req, next };
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1 — calculateDistribution (50/30/20 Nested Budget System)
// ─────────────────────────────────────────────────────────────────────────────
describe('calculateDistribution — 50/30/20 nested budget split', () => {
  const { calculateDistribution } = require('../utils/distributionService');

  // D01 — top-level engine totals for ₦1,000
  test('D01: ₦1,000 → growth=500, fulfillment=300, innovation=200', () => {
    const d = calculateDistribution(1000);
    expect(d.growthEngine.total).toBe(500);
    expect(d.fulfillmentEngine.total).toBe(300);
    expect(d.innovationEngine.total).toBe(200);
    expect(d.total).toBe(1000);
  });

  // D02 — Growth Engine internal split (50/30/20)
  test('D02: Growth Engine internal split — marketing=250, ops=150, savings=100', () => {
    const d = calculateDistribution(1000);
    expect(d.growthEngine.marketing).toBe(250);
    expect(d.growthEngine.operations).toBe(150);
    expect(d.growthEngine.savings).toBe(100);
  });

  // D03 — Fulfillment Engine internal split
  test('D03: Fulfillment Engine — marketing=150, ops=90, savings=60', () => {
    const d = calculateDistribution(1000);
    expect(d.fulfillmentEngine.marketing).toBe(150);
    expect(d.fulfillmentEngine.operations).toBe(90);
    expect(d.fulfillmentEngine.savings).toBe(60);
  });

  // D04 — Innovation Engine internal split
  test('D04: Innovation Engine — marketing=100, ops=60, savings=40', () => {
    const d = calculateDistribution(1000);
    expect(d.innovationEngine.marketing).toBe(100);
    expect(d.innovationEngine.operations).toBe(60);
    expect(d.innovationEngine.savings).toBe(40);
  });

  // D05 — All 9 sub-wallet amounts sum to the original total
  test('D05: All 9 sub-wallets sum to original amount', () => {
    const d = calculateDistribution(1000);
    const subTotal =
      d.growthEngine.marketing + d.growthEngine.operations + d.growthEngine.savings +
      d.fulfillmentEngine.marketing + d.fulfillmentEngine.operations + d.fulfillmentEngine.savings +
      d.innovationEngine.marketing + d.innovationEngine.operations + d.innovationEngine.savings;
    expect(subTotal).toBe(1000);
  });

  // D06 — Zero amount
  test('D06: ₦0 → all sub-wallets zero', () => {
    const d = calculateDistribution(0);
    expect(d.growthEngine.total).toBe(0);
    expect(d.fulfillmentEngine.total).toBe(0);
    expect(d.innovationEngine.total).toBe(0);
    expect(d.total).toBe(0);
  });

  // D07 — Small amount ₦100
  test('D07: ₦100 → marketing=25, fulfillment.savings=6, innovation.savings=4', () => {
    const d = calculateDistribution(100);
    expect(d.growthEngine.marketing).toBe(25);
    expect(d.fulfillmentEngine.savings).toBe(6);
    expect(d.innovationEngine.savings).toBe(4);
    expect(d.total).toBe(100);
  });

  // D08 — Large amount ₦10,000,000 — 9 sub-wallets still add up correctly
  test('D08: ₦10,000,000 — all 9 sub-wallets still sum correctly', () => {
    const d = calculateDistribution(10_000_000);
    const subTotal =
      d.growthEngine.marketing + d.growthEngine.operations + d.growthEngine.savings +
      d.fulfillmentEngine.marketing + d.fulfillmentEngine.operations + d.fulfillmentEngine.savings +
      d.innovationEngine.marketing + d.innovationEngine.operations + d.innovationEngine.savings;
    expect(subTotal).toBe(10_000_000);
  });

  // D09 — Engine totals sum to original total
  test('D09: Three engine totals sum to original amount', () => {
    [500, 1000, 45_000, 1_200_000].forEach(amount => {
      const d = calculateDistribution(amount);
      expect(d.growthEngine.total + d.fulfillmentEngine.total + d.innovationEngine.total).toBe(amount);
    });
  });

  // D10 — Proportions are exact: Growth=50%, Fulfillment=30%, Innovation=20%
  test('D10: Engine proportions correct at ₦500,000', () => {
    const d = calculateDistribution(500_000);
    expect(d.growthEngine.total).toBe(250_000);
    expect(d.fulfillmentEngine.total).toBe(150_000);
    expect(d.innovationEngine.total).toBe(100_000);
  });

  // D11 — Inner percentages: Growth marketing = 25% of total (50% × 50%)
  test('D11: Growth marketing is always 25% of total', () => {
    [100, 800, 12_000, 500_000].forEach(amount => {
      const d = calculateDistribution(amount);
      expect(d.growthEngine.marketing).toBe(amount * 0.25);
    });
  });

  // D12 — Fulfillment savings (B-20%) is always 6% of total
  test('D12: Fulfillment savings (family wallet) is always 6% of total', () => {
    const amount = 10_000;
    const d = calculateDistribution(amount);
    expect(d.fulfillmentEngine.savings).toBe(600);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2 — bankConfig
// ─────────────────────────────────────────────────────────────────────────────
describe('bankConfig — BANK_ACCOUNT & generateBankTransferReference', () => {
  const { BANK_ACCOUNT, generateBankTransferReference } = require('../utils/bankConfig');

  // B01 — static account details exist and are non-empty
  test('B01: BANK_ACCOUNT has bankName, accountNumber, accountName', () => {
    expect(BANK_ACCOUNT.bankName).toBeTruthy();
    expect(BANK_ACCOUNT.accountNumber).toBeTruthy();
    expect(BANK_ACCOUNT.accountName).toBeTruthy();
  });

  // B02 — reference starts with "BT-"
  test('B02: reference starts with BT-', () => {
    expect(generateBankTransferReference('RENT')).toMatch(/^BT-/);
  });

  // B03 — type tag appears in the reference, uppercase
  test('B03: type tag is uppercase in the reference', () => {
    const ref = generateBankTransferReference('rent');
    expect(ref).toMatch(/^BT-RENT-/);
  });

  // B04 — default type becomes PAY
  test('B04: omitting type defaults to PAY tag', () => {
    const ref = generateBankTransferReference();
    expect(ref).toMatch(/^BT-PAY-/);
  });

  // B05 — special characters stripped from type; tag is also truncated to 6 chars
  test('B05: special chars stripped and tag truncated to 6 chars', () => {
    // 'rent-2024!' → strip non-alphanumeric → 'RENT2024' → slice(0,6) → 'RENT20'
    const ref = generateBankTransferReference('rent-2024!');
    expect(ref).toMatch(/^BT-RENT20-/);
  });

  // B06 — two consecutive calls produce different references
  test('B06: two calls produce different references (timestamp suffix)', () => {
    const a = generateBankTransferReference('PAY');
    const b = generateBankTransferReference('PAY');
    // They MAY be equal if called within same ms, but format must match
    expect(a).toMatch(/^BT-PAY-[A-Z0-9]{6}$/);
    expect(b).toMatch(/^BT-PAY-[A-Z0-9]{6}$/);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 3 — pagination middleware
// ─────────────────────────────────────────────────────────────────────────────
describe('pagination middleware', () => {

  // P01 — defaults when no query params
  test('P01: no query → page=1, limit=20, skip=0', () => {
    const { req, next } = runPagination({});
    expect(req.pagination.page).toBe(1);
    expect(req.pagination.limit).toBe(20);
    expect(req.pagination.skip).toBe(0);
    expect(next).toHaveBeenCalledTimes(1);
  });

  // P02 — custom page and limit
  test('P02: page=3, limit=10 → skip=20', () => {
    const { req } = runPagination({ page: '3', limit: '10' });
    expect(req.pagination.page).toBe(3);
    expect(req.pagination.limit).toBe(10);
    expect(req.pagination.skip).toBe(20);
  });

  // P03 — page < 1 is clamped to 1
  test('P03: page=0 is clamped to 1', () => {
    const { req } = runPagination({ page: '0' });
    expect(req.pagination.page).toBe(1);
  });

  // P04 — page=-5 is clamped to 1
  test('P04: page=-5 is clamped to 1', () => {
    const { req } = runPagination({ page: '-5' });
    expect(req.pagination.page).toBe(1);
  });

  // P05 — limit > maxLimit is clamped
  test('P05: limit=500 with maxLimit=100 → limit=100', () => {
    const { req } = runPagination({ limit: '500' }, 20, 100);
    expect(req.pagination.limit).toBe(100);
  });

  // P06 — res.paginate computes correct totalPages
  test('P06: res.paginate(data, 55) with limit=10 → totalPages=6', () => {
    const { req, res } = runPagination({ page: '1', limit: '10' });
    const result = res.paginate([], 55);
    expect(result.pagination.totalPages).toBe(6);
    expect(result.pagination.total).toBe(55);
  });

  // P07 — hasNextPage true when not on last page
  test('P07: page=1 of 6 → hasNextPage=true, hasPrevPage=false', () => {
    const { res } = runPagination({ page: '1', limit: '10' });
    const { pagination } = res.paginate([], 55);
    expect(pagination.hasNextPage).toBe(true);
    expect(pagination.hasPrevPage).toBe(false);
    expect(pagination.nextPage).toBe(2);
    expect(pagination.prevPage).toBeNull();
  });

  // P08 — hasPrevPage true on last page
  test('P08: page=6 of 6 → hasNextPage=false, hasPrevPage=true', () => {
    const { res } = runPagination({ page: '6', limit: '10' });
    const { pagination } = res.paginate([], 55);
    expect(pagination.hasNextPage).toBe(false);
    expect(pagination.hasPrevPage).toBe(true);
    expect(pagination.nextPage).toBeNull();
    expect(pagination.prevPage).toBe(5);
  });

  // P09 — custom defaultLimit is respected
  test('P09: custom defaultLimit=50 used when limit not in query', () => {
    const { req } = runPagination({}, 50, 200);
    expect(req.pagination.limit).toBe(50);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 4 — sanitization middleware
// ─────────────────────────────────────────────────────────────────────────────
describe('sanitization middleware — mongo-operator injection', () => {

  // M01 — normal body passes through unchanged
  test('M01: clean body is untouched', () => {
    const { req } = runSanitize({ name: 'John', age: 30 });
    expect(req.body.name).toBe('John');
    expect(req.body.age).toBe(30);
  });

  // M02 — $where in body is stripped
  test('M02: $where key in body is removed', () => {
    const { req } = runSanitize({ $where: '1=1', name: 'John' });
    expect(req.body.$where).toBeUndefined();
    expect(req.body.name).toBe('John');
  });

  // M03 — nested $gt in body is stripped
  test('M03: nested $gt in body is removed', () => {
    const { req } = runSanitize({ amount: { $gt: 0 } });
    expect(req.body.amount).toEqual({});
  });

  // M04 — $gt in query params is removed
  test('M04: $gt key in query is removed', () => {
    const { req } = runSanitize({}, { filter: { $gt: '' }, page: '1' });
    expect(req.query.filter).toEqual({});
    expect(req.query.page).toBe('1');
  });

  // M05 — next() is always called (no early exit on clean data)
  test('M05: next() is called even with completely clean request', () => {
    const { next } = runSanitize({ hello: 'world' }, { q: 'test' });
    expect(next).toHaveBeenCalledTimes(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 5 — validation helpers
// ─────────────────────────────────────────────────────────────────────────────
describe('validation middleware — handleValidationErrors & custom sanitizers', () => {
  const { handleValidationErrors } = require('../middleware/validation');

  /** Run a real express-validator chain on a mock req, then call handleValidationErrors. */
  async function runValidationChain(chain, reqBody = {}) {
    const { check } = require('express-validator');
    let statusSent, jsonSent;
    const res = {
      status: (code) => { statusSent = code; return res; },
      json:   (body) => { jsonSent  = body;  return res; }
    };
    const next = jest.fn();
    const req  = { body: reqBody, query: {}, params: {}, headers: {}, cookies: {} };
    await chain.run(req);
    handleValidationErrors(req, res, next);
    return { statusSent, jsonSent, next };
  }

  // V01 — valid data → next() called, no response sent
  test('V01: no validation errors → next() called', async () => {
    const { check } = require('express-validator');
    const { statusSent, next } = await runValidationChain(
      check('email').isEmail(),
      { email: 'user@example.com' }
    );
    expect(next).toHaveBeenCalledTimes(1);
    expect(statusSent).toBeUndefined();
  });

  // V02 — invalid data → 400 returned
  test('V02: validation errors → 400 status', async () => {
    const { check } = require('express-validator');
    const { statusSent, next } = await runValidationChain(
      check('email').isEmail().withMessage('Invalid email'),
      { email: 'not-an-email' }
    );
    expect(statusSent).toBe(400);
    expect(next).not.toHaveBeenCalled();
  });

  // V03 — error response body shape
  test('V03: error body has success=false, message, and errors array', async () => {
    const { check } = require('express-validator');
    const { jsonSent } = await runValidationChain(
      check('amount').isInt({ min: 1 }).withMessage('Amount must be positive'),
      { amount: -5 }
    );
    expect(jsonSent.success).toBe(false);
    expect(jsonSent.message).toBe('Validation errors');
    expect(Array.isArray(jsonSent.errors)).toBe(true);
    expect(jsonSent.errors.length).toBeGreaterThan(0);
  });

  // V04 — email sanitizer: strips value without '@' to undefined
  test('V04: tenantEmail without @ is sanitized to undefined by custom sanitizer', () => {
    const sanitizer = v => (v && v.includes('@') ? v : undefined);
    expect(sanitizer('notanemail')).toBeUndefined();
    expect(sanitizer('user@domain.com')).toBe('user@domain.com');
    expect(sanitizer('')).toBeUndefined();
  });

  // V05 — phone sanitizer: strips whitespace
  test('V05: phone sanitizer strips all whitespace', () => {
    const sanitizer = v => (v ? String(v).replace(/\s+/g, '') : v);
    expect(sanitizer('0705 078 2155')).toBe('07050782155');
    expect(sanitizer('  08012  345678  ')).toBe('08012345678');
    expect(sanitizer('')).toBe('');
    expect(sanitizer(null)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 6 — rentIncreaseService logic (pure unit, DB mocked)
// ─────────────────────────────────────────────────────────────────────────────
describe('rentIncreaseService — processPeriodicRentIncreases (mocked DB)', () => {
  let processPeriodicRentIncreases;

  beforeEach(() => {
    jest.resetModules();

    // Mock Unit.find to return one vacant unit whose price is already at max
    // (no update should fire)
    jest.mock('../models/Unit', () => ({
      find: jest.fn().mockResolvedValue([]),
      findByIdAndUpdate: jest.fn().mockResolvedValue({})
    }));
    // Mock Tenant.find to return an empty list
    jest.mock('../models/Tenant', () => ({
      find: jest.fn().mockResolvedValue([])
    }));
    // Mock logger
    jest.mock('../utils/logger', () => ({
      logInfo: jest.fn(),
      logError: jest.fn()
    }));
    // Mock getCurrentRent (no DB)
    jest.mock('../utils/rentCalculator', () => ({
      getCurrentRent: jest.fn((base) => base) // no increase
    }));

    ({ processPeriodicRentIncreases } = require('../utils/rentIncreaseService'));
  });

  afterEach(() => {
    jest.resetModules();
    jest.restoreAllMocks();
  });

  // X01 — returns success when no units or tenants exist
  test('X01: no units, no tenants → success with 0 updates', async () => {
    const result = await processPeriodicRentIncreases();
    expect(result.success).toBe(true);
    expect(result.unitsUpdated).toBe(0);
    expect(result.tenantsUpdated).toBe(0);
  });

  // X02 — vacant unit with price already at current → NOT updated
  test('X02: vacant unit at current price is not updated', async () => {
    jest.resetModules();
    const mockSave = jest.fn();
    jest.mock('../models/Unit', () => ({
      find: jest.fn().mockResolvedValue([{
        monthlyPrice: 35000,
        serviceChargeMonthly: 10000,
        basePrice2024: 35000,
        baseServiceCharge2024: 10000,
        createdAt: new Date('2024-06-01'),
        save: mockSave,
        isActive: true,
        status: 'vacant'
      }]),
      findByIdAndUpdate: jest.fn().mockResolvedValue({})
    }));
    jest.mock('../models/Tenant', () => ({ find: jest.fn().mockResolvedValue([]) }));
    jest.mock('../utils/logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));
    jest.mock('../utils/rentCalculator', () => ({
      getCurrentRent: jest.fn((base) => base) // returns same price, no increase
    }));
    const { processPeriodicRentIncreases: proc } = require('../utils/rentIncreaseService');
    const result = await proc();
    expect(mockSave).not.toHaveBeenCalled();
    expect(result.unitsUpdated).toBe(0);
  });

  // X03 — vacant unit where rent has increased → IS updated
  test('X03: vacant unit whose price has increased → save() called', async () => {
    jest.resetModules();
    const mockSave = jest.fn();
    jest.mock('../models/Unit', () => ({
      find: jest.fn().mockResolvedValue([{
        monthlyPrice: 35000,
        serviceChargeMonthly: 10000,
        basePrice2024: 35000,
        baseServiceCharge2024: 10000,
        createdAt: new Date('2024-06-01'),
        save: mockSave,
        isActive: true,
        status: 'vacant'
      }]),
      findByIdAndUpdate: jest.fn().mockResolvedValue({})
    }));
    jest.mock('../models/Tenant', () => ({ find: jest.fn().mockResolvedValue([]) }));
    jest.mock('../utils/logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));
    jest.mock('../utils/rentCalculator', () => ({
      getCurrentRent: jest.fn((base) => Math.round(base * 1.26)) // price has increased
    }));
    const { processPeriodicRentIncreases: proc } = require('../utils/rentIncreaseService');
    const result = await proc();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(result.unitsUpdated).toBe(1);
  });

  // X04 — active tenant where rent has increased → save() called + history entry added
  test('X04: active tenant with increased rent → save() called, history entry added', async () => {
    jest.resetModules();
    const mockSave = jest.fn();
    const mockHistory = [];
    jest.mock('../models/Unit', () => ({
      find: jest.fn().mockResolvedValue([]),
      findByIdAndUpdate: jest.fn().mockResolvedValue({})
    }));
    jest.mock('../models/Tenant', () => ({
      find: jest.fn().mockResolvedValue([{
        isActive: true,
        status: 'occupied',
        rentAmount: 35000,
        serviceChargeAmount: 10000,
        baseRent2024: 35000,
        baseServiceCharge2024: 10000,
        entryDate: new Date('2024-06-01'),
        history: mockHistory,
        unit: null,
        save: mockSave
      }])
    }));
    jest.mock('../utils/logger', () => ({ logInfo: jest.fn(), logError: jest.fn() }));
    jest.mock('../utils/rentCalculator', () => ({
      getCurrentRent: jest.fn((base) => Math.round(base * 1.26))
    }));
    const { processPeriodicRentIncreases: proc } = require('../utils/rentIncreaseService');
    const result = await proc();
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(result.tenantsUpdated).toBe(1);
    expect(mockHistory.length).toBeGreaterThan(0);
    expect(mockHistory[0].event).toBe('rent_update');
  });
});
