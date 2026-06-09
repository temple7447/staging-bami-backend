/**
 * Pagination Middleware Tests
 *
 * Tests the pagination() factory: query-string parsing, clamping rules,
 * skip calculation, and the res.paginate() helper it attaches.
 */

const pagination = require('../middleware/pagination');

// ─── helpers ─────────────────────────────────────────────────────────────────

function run(query = {}, defaultLimit = 20, maxLimit = 100) {
  const req = { query };
  const res = {};
  const next = jest.fn();
  pagination(defaultLimit, maxLimit)(req, res, next);
  return { req, res, next };
}

// ─── Suite 1: req.pagination values ──────────────────────────────────────────

describe('pagination middleware — req.pagination', () => {

  test('S01: no query → page=1, limit=defaultLimit, skip=0', () => {
    const { req } = run({});
    expect(req.pagination).toEqual({ page: 1, limit: 20, skip: 0, maxLimit: 100 });
  });

  test('S02: explicit page=3 & limit=10 → skip=20', () => {
    const { req } = run({ page: '3', limit: '10' });
    expect(req.pagination.page).toBe(3);
    expect(req.pagination.limit).toBe(10);
    expect(req.pagination.skip).toBe(20);
  });

  test('S03: page < 1 is clamped to 1', () => {
    const { req } = run({ page: '0' });
    expect(req.pagination.page).toBe(1);
  });

  test('S04: negative page is clamped to 1', () => {
    const { req } = run({ page: '-5' });
    expect(req.pagination.page).toBe(1);
  });

  test('S05: limit < 1 falls back to defaultLimit', () => {
    const { req } = run({ limit: '0' }, 20, 100);
    expect(req.pagination.limit).toBe(20);
  });

  test('S06: limit > maxLimit is clamped to maxLimit', () => {
    const { req } = run({ limit: '200' }, 20, 100);
    expect(req.pagination.limit).toBe(100);
  });

  test('S07: custom defaultLimit and maxLimit are respected', () => {
    const { req } = run({}, 50, 200);
    expect(req.pagination.limit).toBe(50);
    expect(req.pagination.maxLimit).toBe(200);
  });

  test('S08: non-numeric query values fall back to defaults', () => {
    const { req } = run({ page: 'abc', limit: 'xyz' });
    expect(req.pagination.page).toBe(1);
    expect(req.pagination.limit).toBe(20);
  });

  test('S09: page=5 limit=15 → skip=60', () => {
    const { req } = run({ page: '5', limit: '15' });
    expect(req.pagination.skip).toBe(60);
  });

  test('S10: always calls next()', () => {
    const { next } = run({ page: '2' });
    expect(next).toHaveBeenCalledTimes(1);
  });

});

// ─── Suite 2: res.paginate helper ────────────────────────────────────────────

describe('pagination middleware — res.paginate()', () => {

  test('S11: first page — hasPrevPage=false, prevPage=null', () => {
    const { res } = run({ page: '1', limit: '10' });
    const result = res.paginate(['a', 'b'], 50);
    expect(result.pagination.hasPrevPage).toBe(false);
    expect(result.pagination.prevPage).toBeNull();
  });

  test('S12: middle page — hasNextPage and hasPrevPage both true', () => {
    const { res } = run({ page: '3', limit: '10' });
    const result = res.paginate([], 50);
    expect(result.pagination.hasNextPage).toBe(true);
    expect(result.pagination.hasPrevPage).toBe(true);
    expect(result.pagination.nextPage).toBe(4);
    expect(result.pagination.prevPage).toBe(2);
  });

  test('S13: last page — hasNextPage=false, nextPage=null', () => {
    const { res } = run({ page: '5', limit: '10' });
    const result = res.paginate([], 50);
    expect(result.pagination.hasNextPage).toBe(false);
    expect(result.pagination.nextPage).toBeNull();
  });

  test('S14: totalPages calculation is correct', () => {
    const { res } = run({ page: '1', limit: '7' });
    const result = res.paginate([], 21);
    expect(result.pagination.totalPages).toBe(3);
  });

  test('S15: success flag is always true', () => {
    const { res } = run({});
    const result = res.paginate([], 0);
    expect(result.success).toBe(true);
  });

  test('S16: data array is passed through unchanged', () => {
    const { res } = run({});
    const data = [{ id: 1 }, { id: 2 }];
    const result = res.paginate(data, 100);
    expect(result.data).toBe(data);
  });

});
