/**
 * Validation Middleware and Sanitization Middleware Tests
 *
 * handleValidationErrors: 6 scenarios covering the two code paths
 *   (no errors → next(), errors present → 400 with structured body).
 *
 * sanitizationMiddleware: 8 scenarios exercising mongo-sanitize integration
 *   on body / query / params and error forwarding.
 */

// Partial mock: real body/check/param/validationChains; only validationResult is mocked
jest.mock('express-validator', () => {
  const actual = jest.requireActual('express-validator');
  return { ...actual, validationResult: jest.fn() };
});

const { validationResult } = require('express-validator');
const { handleValidationErrors }  = require('../middleware/validation');
const sanitizationMiddleware       = require('../middleware/sanitization');

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeRes() {
  return {
    _status: null, _json: null,
    status(c) { this._status = c; return this; },
    json(d)   { this._json  = d; return this; },
  };
}

// ─── Suite 1: handleValidationErrors ─────────────────────────────────────────

describe('handleValidationErrors', () => {

  test('S01: calls next() when there are no validation errors', () => {
    validationResult.mockReturnValue({ isEmpty: () => true });
    const next = jest.fn();
    handleValidationErrors({}, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('S02: does NOT call next() when errors are present', () => {
    validationResult.mockReturnValue({ isEmpty: () => false, array: () => [{ msg: 'required' }] });
    const next = jest.fn();
    handleValidationErrors({}, makeRes(), next);
    expect(next).not.toHaveBeenCalled();
  });

  test('S03: returns HTTP 400 when errors are present', () => {
    validationResult.mockReturnValue({ isEmpty: () => false, array: () => [{ msg: 'bad' }] });
    const res = makeRes();
    handleValidationErrors({}, res, jest.fn());
    expect(res._status).toBe(400);
  });

  test('S04: response body has success: false', () => {
    validationResult.mockReturnValue({ isEmpty: () => false, array: () => [{ msg: 'bad' }] });
    const res = makeRes();
    handleValidationErrors({}, res, jest.fn());
    expect(res._json.success).toBe(false);
  });

  test('S05: response message is "Validation errors"', () => {
    validationResult.mockReturnValue({ isEmpty: () => false, array: () => [{ msg: 'bad' }] });
    const res = makeRes();
    handleValidationErrors({}, res, jest.fn());
    expect(res._json.message).toBe('Validation errors');
  });

  test('S06: response includes the errors array returned by validationResult', () => {
    const errArray = [{ msg: 'name is required', path: 'name' }];
    validationResult.mockReturnValue({ isEmpty: () => false, array: () => errArray });
    const res = makeRes();
    handleValidationErrors({}, res, jest.fn());
    expect(res._json.errors).toEqual(errArray);
  });

});

// ─── Suite 2: sanitizationMiddleware ─────────────────────────────────────────

describe('sanitizationMiddleware', () => {

  test('S07: strips MongoDB $ operators from req.body', () => {
    const req = { body: { $where: '1==1' }, query: {}, params: {} };
    const next = jest.fn();
    sanitizationMiddleware(req, makeRes(), next);
    expect(req.body).not.toHaveProperty('$where');
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('S08: strips $ operators from req.query', () => {
    const req = { body: {}, query: { filter: { $gt: 0 } }, params: {} };
    sanitizationMiddleware(req, makeRes(), jest.fn());
    expect(req.query.filter).not.toHaveProperty('$gt');
  });

  test('S09: strips $ operators from req.params', () => {
    const req = { body: {}, query: {}, params: { id: { $ne: null } } };
    sanitizationMiddleware(req, makeRes(), jest.fn());
    expect(req.params.id).not.toHaveProperty('$ne');
  });

  test('S10: preserves normal string values unchanged', () => {
    const req = { body: { name: 'Alice', role: 'admin' }, query: {}, params: {} };
    sanitizationMiddleware(req, makeRes(), jest.fn());
    expect(req.body.name).toBe('Alice');
    expect(req.body.role).toBe('admin');
  });

  test('S11: calls next() with no arguments on success', () => {
    const next = jest.fn();
    sanitizationMiddleware({ body: {}, query: {}, params: {} }, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeUndefined();
  });

  test('S12: strips nested $ keys inside body objects', () => {
    const req = { body: { filter: { name: 'Alice', $regex: '.*' } }, query: {}, params: {} };
    sanitizationMiddleware(req, makeRes(), jest.fn());
    expect(req.body.filter).not.toHaveProperty('$regex');
    expect(req.body.filter.name).toBe('Alice');
  });

  test('S13: calls next(error) when reading req.body throws', () => {
    const req = {
      get body() { throw new Error('parse error'); },
      query: {},
      params: {},
    };
    const next = jest.fn();
    sanitizationMiddleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  test('S14: handles undefined req.body without crashing', () => {
    const req = { body: undefined, query: {}, params: {} };
    const next = jest.fn();
    sanitizationMiddleware(req, makeRes(), next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(next.mock.calls[0][0]).toBeUndefined();
  });

});
