/**
 * validateEnv Utility Tests
 *
 * Tests the requiredEnvVars list shape and the validateEnv() function's
 * return value / side-effects. process.exit is mocked so missing-var
 * scenarios don't terminate the Jest process.
 */

const { validateEnv, requiredEnvVars } = require('../utils/validateEnv');

// ─── helpers ─────────────────────────────────────────────────────────────────

/** Save and restore process.env around a test that mutates it. */
function withEnv(overrides, fn) {
  const saved = {};
  // Stash current values
  [...requiredEnvVars, 'PORT', 'NODE_ENV', 'RATE_LIMIT_WINDOW_MS', 'RATE_LIMIT_MAX_REQUESTS', 'LOG_LEVEL'].forEach(k => {
    saved[k] = process.env[k];
  });
  // Apply overrides (undefined means delete)
  Object.entries(overrides).forEach(([k, v]) => {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  });
  try {
    return fn();
  } finally {
    // Restore
    Object.entries(saved).forEach(([k, v]) => {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    });
  }
}

// ─── Suite 1: requiredEnvVars list ───────────────────────────────────────────

describe('requiredEnvVars list', () => {

  test('S01: contains MONGODB_URI', () => {
    expect(requiredEnvVars).toContain('MONGODB_URI');
  });

  test('S02: contains JWT_SECRET', () => {
    expect(requiredEnvVars).toContain('JWT_SECRET');
  });

  test('S03: contains JWT_EXPIRE', () => {
    expect(requiredEnvVars).toContain('JWT_EXPIRE');
  });

  test('S04: is an array with at least 3 entries', () => {
    expect(Array.isArray(requiredEnvVars)).toBe(true);
    expect(requiredEnvVars.length).toBeGreaterThanOrEqual(3);
  });

});

// ─── Suite 2: validateEnv() — happy path ─────────────────────────────────────

describe('validateEnv() — all required vars present', () => {

  test('S05: returns { valid: true } when all required vars are set', () => {
    withEnv(
      { MONGODB_URI: 'mongodb://localhost/test', JWT_SECRET: 'supersecretkey', JWT_EXPIRE: '7d', NODE_ENV: 'test' },
      () => {
        const result = validateEnv();
        expect(result.valid).toBe(true);
      }
    );
  });

  test('S06: returns object with warnings array', () => {
    withEnv(
      { MONGODB_URI: 'mongodb://localhost/test', JWT_SECRET: 'key', JWT_EXPIRE: '1d', NODE_ENV: 'test' },
      () => {
        const result = validateEnv();
        expect(Array.isArray(result.warnings)).toBe(true);
      }
    );
  });

});

// ─── Suite 3: validateEnv() — optional var defaults ──────────────────────────

describe('validateEnv() — optional var defaults', () => {

  test('S07: sets PORT default (4000) when PORT is not set', () => {
    withEnv(
      { MONGODB_URI: 'mongodb://localhost/test', JWT_SECRET: 'key', JWT_EXPIRE: '1d', NODE_ENV: 'test', PORT: undefined },
      () => {
        validateEnv();
        expect(process.env.PORT).toBeDefined();
      }
    );
  });

  test('S08: sets LOG_LEVEL default when LOG_LEVEL is not set', () => {
    withEnv(
      { MONGODB_URI: 'mongodb://localhost/test', JWT_SECRET: 'key', JWT_EXPIRE: '1d', NODE_ENV: 'test', LOG_LEVEL: undefined },
      () => {
        validateEnv();
        expect(process.env.LOG_LEVEL).toBeDefined();
      }
    );
  });

  test('S09: sets RATE_LIMIT_MAX_REQUESTS default when not set', () => {
    withEnv(
      { MONGODB_URI: 'mongodb://localhost/test', JWT_SECRET: 'key', JWT_EXPIRE: '1d', NODE_ENV: 'test', RATE_LIMIT_MAX_REQUESTS: undefined },
      () => {
        validateEnv();
        expect(process.env.RATE_LIMIT_MAX_REQUESTS).toBeDefined();
      }
    );
  });

});

// ─── Suite 4: validateEnv() — missing required vars ─────────────────────────

describe('validateEnv() — missing required vars call process.exit', () => {

  let exitSpy;

  beforeEach(() => {
    exitSpy = jest.spyOn(process, 'exit').mockImplementation(() => {});
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  test('S10: calls process.exit(1) when MONGODB_URI is missing', () => {
    withEnv(
      { MONGODB_URI: undefined, JWT_SECRET: 'key', JWT_EXPIRE: '1d', NODE_ENV: 'test' },
      () => {
        validateEnv();
        expect(exitSpy).toHaveBeenCalledWith(1);
      }
    );
  });

  test('S11: calls process.exit(1) when JWT_SECRET is missing', () => {
    withEnv(
      { MONGODB_URI: 'mongodb://localhost/test', JWT_SECRET: undefined, JWT_EXPIRE: '1d', NODE_ENV: 'test' },
      () => {
        validateEnv();
        expect(exitSpy).toHaveBeenCalledWith(1);
      }
    );
  });

  test('S12: calls process.exit(1) when JWT_EXPIRE is missing', () => {
    withEnv(
      { MONGODB_URI: 'mongodb://localhost/test', JWT_SECRET: 'key', JWT_EXPIRE: undefined, NODE_ENV: 'test' },
      () => {
        validateEnv();
        expect(exitSpy).toHaveBeenCalledWith(1);
      }
    );
  });

});
