/**
 * Request-ID & API-Version Middleware Tests
 *
 * requestIdMiddleware: honours X-Request-ID header when present; generates a
 *   fresh UUID v4 otherwise. Attaches id to req and echoes it in the response.
 *
 * versioningMiddleware: stamps req.apiVersion and the API-Version response header.
 * versionedRoutes: mounts handlers under /api/v1<path>.
 */

// uuid v13 uses ESM — mock it so Jest (CommonJS) can load the middleware
jest.mock('uuid', () => ({
  v4: jest
    .fn()
    .mockReturnValueOnce('aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee')
    .mockReturnValueOnce('11111111-2222-4333-8444-555555555555')
    .mockImplementation(() => 'zzzzzzzz-zzzz-4zzz-8zzz-zzzzzzzzzzzz'),
}));

const requestIdMiddleware = require('../middleware/requestId');
const { versioningMiddleware, versionedRoutes, apiVersion } = require('../middleware/apiVersion');

// ─── helpers ─────────────────────────────────────────────────────────────────

function runRequestId(headerValue) {
  const headers = {};
  const req = { headers: headerValue ? { 'x-request-id': headerValue } : {} };
  const res = { setHeader: jest.fn() };
  const next = jest.fn();
  requestIdMiddleware(req, res, next);
  return { req, res, next };
}

function runVersioning() {
  const req = {};
  const res = { setHeader: jest.fn() };
  const next = jest.fn();
  versioningMiddleware(req, res, next);
  return { req, res, next };
}

// ─── Suite 1: requestIdMiddleware ────────────────────────────────────────────

describe('requestIdMiddleware', () => {

  test('S01: uses existing X-Request-ID header when provided', () => {
    const { req } = runRequestId('my-custom-id-123');
    expect(req.id).toBe('my-custom-id-123');
  });

  test('S02: generates an ID via uuid.v4() when no header is present', () => {
    const { req } = runRequestId(null);
    // mocked uuid.v4 returns a deterministic value — just confirm id is a non-empty string
    expect(typeof req.id).toBe('string');
    expect(req.id.length).toBeGreaterThan(0);
  });

  test('S03: echoes the ID in the X-Request-ID response header', () => {
    const { req, res } = runRequestId('echo-me');
    expect(res.setHeader).toHaveBeenCalledWith('X-Request-ID', 'echo-me');
  });

  test('S04: generated UUID is set in X-Request-ID response header', () => {
    const { req, res } = runRequestId(null);
    const [headerName, headerValue] = res.setHeader.mock.calls[0];
    expect(headerName).toBe('X-Request-ID');
    expect(headerValue).toBe(req.id);
  });

  test('S05: calls next()', () => {
    const { next } = runRequestId(null);
    expect(next).toHaveBeenCalledTimes(1);
  });

  test('S06: uuid.v4 is called when no X-Request-ID header is provided', () => {
    const { v4 } = require('uuid');
    v4.mockClear();
    runRequestId(null);
    expect(v4).toHaveBeenCalledTimes(1);
  });

});

// ─── Suite 2: versioningMiddleware ───────────────────────────────────────────

describe('versioningMiddleware', () => {

  test('S07: sets req.apiVersion to "v1"', () => {
    const { req } = runVersioning();
    expect(req.apiVersion).toBe('v1');
  });

  test('S08: sets API-Version response header to "v1"', () => {
    const { res } = runVersioning();
    expect(res.setHeader).toHaveBeenCalledWith('API-Version', 'v1');
  });

  test('S09: calls next()', () => {
    const { next } = runVersioning();
    expect(next).toHaveBeenCalledTimes(1);
  });

});

// ─── Suite 3: exported apiVersion constant & versionedRoutes ─────────────────

describe('apiVersion constant & versionedRoutes', () => {

  test('S10: exported apiVersion constant is "v1"', () => {
    expect(apiVersion).toBe('v1');
  });

  test('S11: versionedRoutes mounts handler under /api/v1<path>', () => {
    const app = { use: jest.fn() };
    const handler = jest.fn();
    const register = versionedRoutes(app);
    register('/estates', handler);
    expect(app.use).toHaveBeenCalledWith('/api/v1/estates', handler);
  });

  test('S12: versionedRoutes correctly prefixes multiple different paths', () => {
    const app = { use: jest.fn() };
    const register = versionedRoutes(app);
    register('/tenants', jest.fn());
    register('/units', jest.fn());
    expect(app.use.mock.calls[0][0]).toBe('/api/v1/tenants');
    expect(app.use.mock.calls[1][0]).toBe('/api/v1/units');
  });

});
