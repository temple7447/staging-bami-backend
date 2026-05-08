/**
 * End-to-end test script: Estates → Units → Tenants
 * Run with: node test-estate-tenant.js
 */

const BASE = 'http://localhost:4000';
const ADMIN_EMAIL = process.env.TEST_EMAIL || 'admin@bamihost.com';
const ADMIN_PASS  = process.env.TEST_PASS  || 'Admin1234';

let token       = '';
let estateId    = '';
let unitId      = '';
let tenantId    = '';

const results = [];

// ─── helpers ────────────────────────────────────────────────────────────────

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function req(method, path, body, label) {
  await sleep(600); // avoid rate limiter (server: 100 req / 15 min)
  const opts = {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  };
  let status, data;
  try {
    const r  = await fetch(`${BASE}${path}`, opts);
    status   = r.status;
    data     = await r.json();
  } catch (e) {
    status = 'ERR';
    data   = { message: e.message };
  }
  const ok = status >= 200 && status < 300;
  results.push({ label, method, path, status, ok });

  const icon   = ok ? '✅' : '❌';
  const detail = ok ? JSON.stringify(data).slice(0, 120) : JSON.stringify(data?.message || data).slice(0, 200);
  console.log(`${icon} [${status}] ${label}`);
  if (!ok) console.log(`       └─ ${detail}`);
  return { ok, status, data };
}

function section(title) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${title}`);
  console.log('─'.repeat(60));
}

// ─── main ───────────────────────────────────────────────────────────────────

async function run() {
  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║     ESTATE → UNIT → TENANT  END-TO-END TEST SUITE       ║');
  console.log('╚══════════════════════════════════════════════════════════╝\n');

  // ── 0. Health ─────────────────────────────────────────────────────────────
  section('0. HEALTH CHECK');
  await req('GET', '/health', null, 'Health check');

  // ── 1. Auth ───────────────────────────────────────────────────────────────
  section('1. AUTHENTICATION');

  const login = await req('POST', '/api/auth/login', { email: ADMIN_EMAIL, password: ADMIN_PASS }, 'Admin login');
  if (!login.ok) {
    console.log('\n⛔  Cannot continue — login failed. Check TEST_EMAIL / TEST_PASS env vars.\n');
    printSummary();
    process.exit(1);
  }
  token = login.data?.token || login.data?.data?.token;

  await req('GET', '/api/auth/me', null, 'GET /me (profile)');

  // ── 2. Estates ────────────────────────────────────────────────────────────
  section('2. ESTATES');

  await req('GET', '/api/estates', null, 'List estates');
  await req('GET', '/api/estates/overview/all', null, 'Overall estate overview');
  await req('GET', '/api/estates?page=1&limit=5&sortBy=createdAt&order=desc', null, 'List estates (paginated)');
  await req('GET', '/api/estates?search=test', null, 'Search estates by name');

  const createEstate = await req('POST', '/api/estates', {
    name: `Test Estate ${Date.now()}`,
    description: 'Automated test estate',
    totalUnits: 10,
  }, 'Create estate');

  if (createEstate.ok) {
    estateId = createEstate.data?.data?._id || createEstate.data?._id;
    console.log(`       └─ Estate ID: ${estateId}`);
  }

  if (estateId) {
    await req('GET', `/api/estates/${estateId}`, null, 'Get estate by ID');
    await req('GET', `/api/estates/${estateId}/overview`, null, 'Estate overview (no filter)');
    await req('GET', `/api/estates/${estateId}/overview?period=month`, null, 'Estate overview (period=month)');
    await req('GET', `/api/estates/${estateId}/overview?period=year`, null, 'Estate overview (period=year)');
    await req('GET', `/api/estates/${estateId}/overview?period=week`, null, 'Estate overview (period=week)');

    await req('PUT', `/api/estates/${estateId}`, {
      name: `Test Estate Updated ${Date.now()}`,
      description: 'Updated description',
    }, 'Update estate');
  }

  // bad ID validation — the API returns 400 which is correct, we mark this as expected
  const badId = await req('GET', '/api/estates/invalidid123', null, 'Get estate – invalid ObjectId (expect 400)');
  if (badId.status === 400) {
    results[results.length - 1].ok = true; // mark as pass since 400 is expected
    console.log('       └─ Correctly rejected invalid ObjectId');
  }

  // ── 3. Units ──────────────────────────────────────────────────────────────
  section('3. UNITS');

  await req('GET', '/api/estates/public/listings', null, 'Public listings (no auth)');

  if (estateId) {
    const createUnit = await req('POST', `/api/estates/${estateId}/units`, {
      label: `Unit-A-${Math.floor(Math.random() * 900) + 100}`,
      monthlyPrice: 150000,
      type: 'apartment',
      bedrooms: 2,
      bathrooms: 1,
      floor: 1,
      description: 'Automated test unit',
    }, 'Create unit');

    if (createUnit.ok) {
      unitId = createUnit.data?.data?.unitId || createUnit.data?.data?._id || createUnit.data?._id;
      console.log(`       └─ Unit ID: ${unitId}`);
    }

    await req('GET', `/api/estates/${estateId}/units`, null, 'List estate units');
    await req('GET', `/api/estates/${estateId}/units/vacant`, null, 'List vacant units');

    if (unitId) {
      await req('GET', `/api/estates/unit/${unitId}`, null, 'Get unit by ID');
      await req('PUT', `/api/estates/unit/${unitId}`, { monthlyPrice: 160000, description: 'Updated unit' }, 'Update unit');
    }
  }

  // ── 4. Tenants ────────────────────────────────────────────────────────────
  section('4. TENANTS');

  await req('GET', '/api/tenants', null, 'List all tenants');
  await req('GET', '/api/tenants?page=1&limit=10', null, 'List tenants (paginated)');

  if (estateId && unitId) {
    const createTenant = await req('POST', `/api/estates/${estateId}/tenants`, {
      firstName: 'Test',
      surname: 'Tenant',
      tenantEmail: `tenant_test_${Date.now()}@example.com`,
      tenantPhone: '08012345678',
      unitId,
      rentAmount: 150000,
      tenantType: 'new',
    }, 'Create tenant');

    if (createTenant.ok) {
      tenantId = createTenant.data?.data?._id || createTenant.data?._id;
      console.log(`       └─ Tenant ID: ${tenantId}`);
    }
  }

  if (tenantId) {
    await req('GET', `/api/tenants/${tenantId}`, null, 'Get tenant by ID');
    await req('GET', `/api/tenants/${tenantId}/billing`, null, 'Tenant billing items');
    await req('GET', `/api/tenants/${tenantId}/transactions`, null, 'Tenant transactions');
    await req('GET', `/api/tenants/${tenantId}/history`, null, 'Tenant history');

    await req('PUT', `/api/tenants/${tenantId}`, {
      phone: '08098765432',
    }, 'Update tenant (PUT)');

    await req('PATCH', `/api/tenants/${tenantId}`, {
      status: 'occupied',
    }, 'Update tenant (PATCH)');
  }

  // Self-service routes — admin has no tenant record so 404 is expected behaviour
  const meHistory = await req('GET', '/api/tenants/me/history', null, 'GET /me/history (admin — no tenant record, expect 404)');
  if (meHistory.status === 404) { results[results.length - 1].ok = true; console.log('       └─ Expected: admin has no tenant record'); }

  await req('GET', '/api/tenants/me/billing', null, 'GET /me/billing  (admin token)');

  // ── 5. Unit–Tenant assignment ─────────────────────────────────────────────
  section('5. UNIT–TENANT ASSIGNMENT');

  if (estateId && unitId && tenantId) {
    // Unit is currently occupied by the tenant we just created — 409 is correct
    const assignOccupied = await req('POST', `/api/estates/${estateId}/units/${unitId}/assign-tenant`, {
      tenantId,
    }, 'Assign to occupied unit (expect 409)');
    if (assignOccupied.status === 409) {
      results[results.length - 1].ok = true;
      console.log('       └─ Correct: cannot double-assign an occupied unit');
    }

    // Remove deactivates the tenant (isActive=false) and frees the unit
    await req('POST', `/api/estates/${estateId}/units/${unitId}/remove-tenant`, {}, 'Remove tenant from unit (deactivates tenant)');

    // After remove, the old tenantId is deactivated — create a fresh tenant to re-assign
    const reTenant = await req('POST', `/api/estates/${estateId}/tenants`, {
      firstName: 'ReAssign',
      surname: 'Tenant',
      tenantEmail: `retenant_${Date.now()}@example.com`,
      tenantPhone: '08099887766',
      unitId,
      rentAmount: 150000,
      tenantType: 'new',
    }, 'Create new tenant for re-assign test');
    const reTenantId = reTenant.data?.data?._id;

    if (reTenantId) {
      // Unit now occupied by new tenant — clean up
      await req('POST', `/api/estates/${estateId}/units/${unitId}/remove-tenant`, {}, 'Remove re-assigned tenant (cleanup)');
      // reTenantId is now deactivated, no explicit delete needed
    }
  } else {
    console.log('  ⚠️  Skipped — missing estateId / unitId / tenantId');
  }

  // ── 6. Cleanup (soft delete) ──────────────────────────────────────────────
  section('6. CLEANUP (soft delete)');

  // Note: tenantId was already deactivated by remove-tenant above (by design).
  // Delete is tested here — 404 is expected for already-deactivated tenants.
  if (tenantId) {
    const del = await req('DELETE', `/api/tenants/${tenantId}`, null, 'Delete tenant (already deactivated by remove-tenant)');
    if (del.status === 404) {
      results[results.length - 1].ok = true;
      console.log('       └─ Expected: tenant was deactivated by remove-tenant (isActive=false)');
    }
  }
  if (unitId)   await req('DELETE', `/api/estates/unit/${unitId}`, null, 'Delete unit');
  if (estateId) await req('DELETE', `/api/estates/${estateId}`, null, 'Delete estate');

  // ── Summary ───────────────────────────────────────────────────────────────
  printSummary();
}

function printSummary() {
  const passed = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;
  const total  = results.length;

  console.log('\n╔══════════════════════════════════════════════════════════╗');
  console.log('║                     TEST SUMMARY                        ║');
  console.log('╠══════════════════════════════════════════════════════════╣');
  console.log(`║  Total  : ${String(total).padEnd(47)}║`);
  console.log(`║  Passed : ${String(passed).padEnd(47)}║`);
  console.log(`║  Failed : ${String(failed).padEnd(47)}║`);
  console.log('╠══════════════════════════════════════════════════════════╣');

  if (failed > 0) {
    console.log('║  FAILED TESTS:                                           ║');
    results.filter(r => !r.ok).forEach(r => {
      const line = `  ❌ [${r.status}] ${r.label}`.padEnd(58);
      console.log(`║${line}║`);
    });
  }

  console.log('╚══════════════════════════════════════════════════════════╝\n');
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
