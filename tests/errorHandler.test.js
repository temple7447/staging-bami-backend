/**
 * Error Handler Middleware Tests
 *
 * Verifies that the errorHandler middleware maps different error shapes
 * (Mongoose CastError, duplicate key, ValidationError, JWT errors, generic errors)
 * to the correct HTTP status codes and response bodies.
 */

const errorHandler = require('../middleware/error');

// ─── helpers ─────────────────────────────────────────────────────────────────

function makeRes() {
  const res = {
    _status: null,
    _json: null,
    status(code) { this._status = code; return this; },
    json(data)  { this._json  = data; return this; },
  };
  return res;
}

function run(errProps) {
  const err = Object.assign(new Error('default'), errProps);
  const res = makeRes();
  errorHandler(err, {}, res, () => {});
  return res;
}

// ─── Suite 1: generic errors ──────────────────────────────────────────────────

describe('errorHandler — generic errors', () => {

  test('S01: unknown error → 500 with success=false', () => {
    const res = run({ message: 'something broke' });
    expect(res._status).toBe(500);
    expect(res._json.success).toBe(false);
  });

  test('S02: unknown error → message echoed back', () => {
    const res = run({ message: 'unexpected failure' });
    expect(res._json.message).toBe('unexpected failure');
  });

  test('S03: error with explicit statusCode uses that code', () => {
    const res = run({ message: 'forbidden', statusCode: 403 });
    expect(res._status).toBe(403);
  });

  test('S04: error with no message → fallback "Server Error"', () => {
    const err = {};
    const res = makeRes();
    errorHandler(err, {}, res, () => {});
    expect(res._json.message).toBe('Server Error');
  });

});

// ─── Suite 2: Mongoose errors ────────────────────────────────────────────────

describe('errorHandler — Mongoose errors', () => {

  test('S05: CastError → 404 "Resource not found"', () => {
    const res = run({ name: 'CastError' });
    expect(res._status).toBe(404);
    expect(res._json.message).toBe('Resource not found');
  });

  test('S06: duplicate key (code 11000) → 400 "Duplicate field value entered"', () => {
    const res = run({ code: 11000 });
    expect(res._status).toBe(400);
    expect(res._json.message).toBe('Duplicate field value entered');
  });

  test('S07: ValidationError → 400 with array of field messages', () => {
    const err = Object.assign(new Error(), {
      name: 'ValidationError',
      errors: {
        email:    { message: 'Email is required' },
        password: { message: 'Password too short' },
      }
    });
    const res = makeRes();
    errorHandler(err, {}, res, () => {});
    expect(res._status).toBe(400);
    expect(res._json.message).toContain('Email is required');
    expect(res._json.message).toContain('Password too short');
  });

  test('S08: ValidationError success flag is false', () => {
    const err = Object.assign(new Error(), {
      name: 'ValidationError',
      errors: { field: { message: 'required' } }
    });
    const res = makeRes();
    errorHandler(err, {}, res, () => {});
    expect(res._json.success).toBe(false);
  });

});

// ─── Suite 3: JWT errors ──────────────────────────────────────────────────────

describe('errorHandler — JWT errors', () => {

  test('S09: JsonWebTokenError → 401 "Invalid token"', () => {
    const res = run({ name: 'JsonWebTokenError' });
    expect(res._status).toBe(401);
    expect(res._json.message).toBe('Invalid token');
  });

  test('S10: TokenExpiredError → 401 "Token expired"', () => {
    const res = run({ name: 'TokenExpiredError' });
    expect(res._status).toBe(401);
    expect(res._json.message).toBe('Token expired');
  });

  test('S11: JWT errors always have success=false', () => {
    const res = run({ name: 'JsonWebTokenError' });
    expect(res._json.success).toBe(false);
  });

});
