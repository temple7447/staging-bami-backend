/**
 * Auth Middleware Tests — role guards only (no DB / JWT involved)
 *
 * Covers: authorize(), superAdminOnly, adminOrSuperAdmin, and
 * filterByOwnership (the synchronous parts — no Estate lookup).
 * The protect() function is excluded here because it requires a live DB.
 */

const { authorize, superAdminOnly, adminOrSuperAdmin, filterByOwnership } = require('../middleware/auth');

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeRes() {
  return {
    _status: null,
    _json: null,
    status(code) { this._status = code; return this; },
    json(data)  { this._json  = data; return this; },
  };
}

// ─── Suite 1: authorize(...roles) ────────────────────────────────────────────

describe('authorize()', () => {

  test('S01: calls next() when user role is in the allowed list', () => {
    const next = jest.fn();
    const req  = { user: { role: 'admin' } };
    authorize('admin', 'manager')(req, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('S02: allows when user matches any one of multiple roles', () => {
    const next = jest.fn();
    const req  = { user: { role: 'manager' } };
    authorize('admin', 'manager', 'super_admin')(req, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('S03: returns 403 when user role is not in the allowed list', () => {
    const res = makeRes();
    authorize('admin')({ user: { role: 'tenant' } }, res, jest.fn());
    expect(res._status).toBe(403);
  });

  test('S04: rejection response has success=false', () => {
    const res = makeRes();
    authorize('super_admin')({ user: { role: 'vendor' } }, res, jest.fn());
    expect(res._json.success).toBe(false);
  });

  test('S05: rejection message contains the user\'s role', () => {
    const res = makeRes();
    authorize('super_admin')({ user: { role: 'vendor' } }, res, jest.fn());
    expect(res._json.message).toContain('vendor');
  });

  test('S06: next() is NOT called on rejection', () => {
    const next = jest.fn();
    authorize('admin')({ user: { role: 'vendor' } }, makeRes(), next);
    expect(next).not.toHaveBeenCalled();
  });

});

// ─── Suite 2: superAdminOnly ─────────────────────────────────────────────────

describe('superAdminOnly', () => {

  test('S07: calls next() for super_admin role', () => {
    const next = jest.fn();
    superAdminOnly({ user: { role: 'super_admin' } }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('S08: returns 403 for admin role', () => {
    const res = makeRes();
    superAdminOnly({ user: { role: 'admin' } }, res, jest.fn());
    expect(res._status).toBe(403);
  });

  test('S09: returns 403 for manager role', () => {
    const res = makeRes();
    superAdminOnly({ user: { role: 'manager' } }, res, jest.fn());
    expect(res._status).toBe(403);
  });

  test('S10: rejection has success=false', () => {
    const res = makeRes();
    superAdminOnly({ user: { role: 'admin' } }, res, jest.fn());
    expect(res._json.success).toBe(false);
  });

});

// ─── Suite 3: adminOrSuperAdmin ───────────────────────────────────────────────

describe('adminOrSuperAdmin', () => {

  test('S11: calls next() for admin role', () => {
    const next = jest.fn();
    adminOrSuperAdmin({ user: { role: 'admin' } }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('S12: calls next() for super_admin role', () => {
    const next = jest.fn();
    adminOrSuperAdmin({ user: { role: 'super_admin' } }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('S13: calls next() for super_manager role', () => {
    const next = jest.fn();
    adminOrSuperAdmin({ user: { role: 'super_manager' } }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('S14: returns 403 for vendor role', () => {
    const res = makeRes();
    adminOrSuperAdmin({ user: { role: 'vendor' } }, res, jest.fn());
    expect(res._status).toBe(403);
  });

  test('S15: returns 403 for manager role', () => {
    const res = makeRes();
    adminOrSuperAdmin({ user: { role: 'manager' } }, res, jest.fn());
    expect(res._status).toBe(403);
  });

});

// ─── Suite 4: filterByOwnership (synchronous paths, no DB) ───────────────────

describe('filterByOwnership — synchronous role branches', () => {

  test('S16: super_admin gets empty dataFilter and canAccessAll=true', async () => {
    const req  = { user: { role: 'super_admin', id: 'uid1' } };
    const next = jest.fn();
    await filterByOwnership(req, makeRes(), next);
    expect(req.dataFilter).toEqual({});
    expect(req.canAccessAll).toBe(true);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('S17: super_vendor gets empty dataFilter and canAccessAll=true', async () => {
    const req  = { user: { role: 'super_vendor', id: 'uid2' } };
    const next = jest.fn();
    await filterByOwnership(req, makeRes(), next);
    expect(req.dataFilter).toEqual({});
    expect(req.canAccessAll).toBe(true);
  });

  test('S18: business_owner gets ownership filter and canAccessAll=false', async () => {
    const req  = { user: { role: 'business_owner', id: 'ownerId', assignedEstates: [] } };
    const next = jest.fn();
    await filterByOwnership(req, makeRes(), next);
    expect(req.canAccessAll).toBe(false);
    expect(req.dataFilter).toHaveProperty('$or');
  });

  test('S19: unknown role gets _id:null filter (no access)', async () => {
    const req  = { user: { role: 'unknown_role', id: 'uid3' } };
    const next = jest.fn();
    await filterByOwnership(req, makeRes(), next);
    expect(req.dataFilter).toEqual({ _id: null });
    expect(req.canAccessAll).toBe(false);
  });

});
