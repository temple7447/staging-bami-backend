/**
 * Logger Utility Tests
 *
 * Tests the logError() helper's return-value contract. logError builds a
 * structured error-details object and returns it — we verify that shape
 * without caring what Winston does internally.
 * Also verifies logInfo and logWarning don't throw on valid inputs.
 */

const { logError, logInfo, logWarning } = require('../utils/logger');

// ─── Suite 1: logError return shape ──────────────────────────────────────────

describe('logError — return value', () => {

  test('S01: returns object containing the endpoint name', () => {
    const result = logError('estates.getAll', new Error('test'));
    expect(result.endpoint).toBe('estates.getAll');
  });

  test('S02: returns error.message from the provided Error', () => {
    const result = logError('tenants.create', new Error('not found'));
    expect(result.error.message).toBe('not found');
  });

  test('S03: includes context object passed as third argument', () => {
    const ctx = { tenantId: 'abc123' };
    const result = logError('billing.update', new Error('oops'), ctx);
    expect(result.context).toEqual(ctx);
  });

  test('S04: handles null error without throwing', () => {
    expect(() => logError('any.endpoint', null)).not.toThrow();
  });

  test('S05: null error → error.message falls back to "No message provided"', () => {
    const result = logError('any.endpoint', null);
    expect(result.error.message).toBe('No message provided');
  });

  test('S06: captures error.code when present', () => {
    const err = Object.assign(new Error('db error'), { code: 'ECONNREFUSED' });
    const result = logError('db.connect', err);
    expect(result.error.code).toBe('ECONNREFUSED');
  });

  test('S07: captures error.name when present', () => {
    const err = Object.assign(new Error('cast fail'), { name: 'CastError' });
    const result = logError('model.find', err);
    expect(result.error.name).toBe('CastError');
  });

  test('S08: returns object even when no context is passed', () => {
    const result = logError('route.handler', new Error('whoops'));
    expect(result).toHaveProperty('endpoint');
    expect(result).toHaveProperty('error');
    expect(result).toHaveProperty('context');
  });

});

// ─── Suite 2: logInfo / logWarning — no-throw contract ───────────────────────

describe('logInfo and logWarning — no-throw contract', () => {

  test('S09: logInfo does not throw with message and data', () => {
    expect(() => logInfo('server started', { port: 4000 })).not.toThrow();
  });

  test('S10: logInfo does not throw with message only', () => {
    expect(() => logInfo('payment processed')).not.toThrow();
  });

  test('S11: logWarning does not throw with message and data', () => {
    expect(() => logWarning('rate limit approaching', { requests: 180 })).not.toThrow();
  });

  test('S12: logWarning does not throw with message only', () => {
    expect(() => logWarning('deprecated field used')).not.toThrow();
  });

});
