#!/usr/bin/env node

/**
 * COMPREHENSIVE FEATURE TEST SUITE
 * Tests all major functionalities of the BamiHustle backend
 */

const http = require('http');
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m'
};

const BASE_URL = 'http://localhost:5000';
let testResults = [];
let tokenAuth = null;
let adminToken = null;
let tenantId = null;
let estateId = null;
let unitId = null;
let walletId = null;

// Utility to make HTTP requests
async function makeRequest(method, endpoint, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const urlString = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
    const url = new URL(urlString);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'BamiHustle-Test-Suite',
        ...headers
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = {
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null
          };
          resolve(response);
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data
          });
        }
      });
    });

    req.on('error', reject);

    if (body) {
      req.write(JSON.stringify(body));
    }
    req.end();
  });
}

// Test result logger
function logTest(name, passed, details = '') {
  testResults.push({ name, passed, details });
  const status = passed
    ? `${colors.green}✅ PASS${colors.reset}`
    : `${colors.red}❌ FAIL${colors.reset}`;
  console.log(`${status} | ${name}${details ? ` (${details})` : ''}`);
}

// Section header
function logSection(title) {
  console.log(`\n${colors.cyan}${colors.bright}═══════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}${title.padEnd(35)}${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}═══════════════════════════════════${colors.reset}\n`);
}

// Health check
async function testHealthCheck() {
  logSection('🏥 SYSTEM HEALTH CHECK');
  try {
    const response = await makeRequest('GET', `${BASE_URL}/api/test/scheduler-status`);
    logTest('Server Health', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Server Health', false, e.message);
  }
}

// Authentication Tests
async function testAuthentication() {
  logSection('🔐 AUTHENTICATION TESTS');

  // Test user registration
  const registerPayload = {
    name: `TestUser${Date.now()}`,
    email: `testuser${Date.now()}@test.com`,
    password: 'TestPass123!'
  };

  try {
    const response = await makeRequest('POST', '/api/auth/register-super-admin', registerPayload);
    logTest('User Registration', response.status === 201 || response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('User Registration', false, e.message);
  }

  // Test user login
  const loginPayload = {
    email: 'starukido@gmail.com',
    password: 'SuperAdmin123!'
  };

  try {
    const response = await makeRequest('POST', '/api/auth/login', loginPayload);
    if (response.body && response.body.token) {
      adminToken = response.body.token;
      logTest('Admin Login', response.status === 200, `Status: ${response.status}`);
    } else {
      logTest('Admin Login', false, `No token received. Response: ${JSON.stringify(response.body)}`);
    }
  } catch (e) {
    logTest('Admin Login', false, e.message);
  }
}

// Tenant Management Tests
async function testTenantManagement() {
  logSection('👥 TENANT MANAGEMENT TESTS');

  const tenantPayload = {
    email: `tenant${Date.now()}@test.com`,
    firstName: 'John',
    lastName: 'Doe',
    phone: '08098765432'
  };

  try {
    const response = await makeRequest('POST', '/api/tenants', tenantPayload, {
      'Authorization': `Bearer ${adminToken}`
    });
    if (response.body && response.body.data && response.body.data._id) {
      tenantId = response.body.data._id;
    }
    logTest('Create Tenant', response.status === 201 || response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Create Tenant', false, e.message);
  }

  // Get tenants list
  try {
    const response = await makeRequest('GET', '/api/tenants?page=1&limit=10', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('List Tenants', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('List Tenants', false, e.message);
  }

  // Get tenant by ID
  if (tenantId) {
    try {
      const response = await makeRequest('GET', `/api/tenants/${tenantId}`, null, {
        'Authorization': `Bearer ${adminToken}`
      });
      logTest('Get Tenant Details', response.status === 200, `Status: ${response.status}`);
    } catch (e) {
      logTest('Get Tenant Details', false, e.message);
    }
  }
}

// Estate Management Tests
async function testEstateManagement() {
  logSection('🏘️  ESTATE MANAGEMENT TESTS');

  const estatePayload = {
    name: `Test Estate ${Date.now()}`,
    address: '123 Main St, Lagos',
    city: 'Lagos',
    state: 'Lagos',
    description: 'Test Estate for automation'
  };

  try {
    const response = await makeRequest('POST', '/api/estates', estatePayload, {
      'Authorization': `Bearer ${adminToken}`
    });
    if (response.body && response.body.data && response.body.data._id) {
      estateId = response.body.data._id;
    }
    logTest('Create Estate', response.status === 201 || response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Create Estate', false, e.message);
  }

  // Get estates list
  try {
    const response = await makeRequest('GET', '/api/estates?page=1&limit=20', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('List Estates', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('List Estates', false, e.message);
  }

  // Get estate details
  if (estateId) {
    try {
      const response = await makeRequest('GET', `/api/estates/${estateId}`, null, {
        'Authorization': `Bearer ${adminToken}`
      });
      logTest('Get Estate Details', response.status === 200, `Status: ${response.status}`);
    } catch (e) {
      logTest('Get Estate Details', false, e.message);
    }
  }
}

// Unit Management Tests
async function testUnitManagement() {
  logSection('🏠 UNIT MANAGEMENT TESTS');

  const unitPayload = {
    unitNumber: `UNIT-${Date.now()}`,
    bedrooms: 3,
    bathrooms: 2,
    type: 'apartment',
    estateId: estateId || '507f1f77bcf86cd799439011',
    status: 'available'
  };

  try {
    const response = await makeRequest('POST', '/api/estates/units', unitPayload, {
      'Authorization': `Bearer ${adminToken}`
    });
    if (response.body && response.body.data && response.body.data._id) {
      unitId = response.body.data._id;
    }
    logTest('Create Unit', response.status === 201 || response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Create Unit', false, e.message);
  }

  // Get units list
  try {
    const response = await makeRequest('GET', '/api/estates/units?page=1&limit=20', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('List Units', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('List Units', false, e.message);
  }

  // Get unit details
  if (unitId) {
    try {
      const response = await makeRequest('GET', `/api/estates/units/${unitId}`, null, {
        'Authorization': `Bearer ${adminToken}`
      });
      logTest('Get Unit Details', response.status === 200, `Status: ${response.status}`);
    } catch (e) {
      logTest('Get Unit Details', false, e.message);
    }
  }
}

// Wallet Tests
async function testWallet() {
  logSection('💰 WALLET & FINANCIAL TESTS');

  // Get wallet
  try {
    const response = await makeRequest('GET', '/api/wallet', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    if (response.body && response.body.data && response.body.data._id) {
      walletId = response.body.data._id;
    }
    logTest('Get Wallet Info', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Wallet Info', false, e.message);
  }

  // Get wallet balance
  try {
    const response = await makeRequest('GET', '/api/wallet/balance', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Get Wallet Balance', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Wallet Balance', false, e.message);
  }

  // Get wallet transactions
  try {
    const response = await makeRequest('GET', '/api/wallet/transactions?page=1&limit=20', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Get Wallet Transactions', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Wallet Transactions', false, e.message);
  }
}

// Payment Tests
async function testPaymentSystem() {
  logSection('💳 PAYMENT SYSTEM TESTS');

  // Initialize payment
  const paymentPayload = {
    amount: 50000,
    description: 'Test rent payment',
    paymentType: 'rent'
  };

  try {
    const response = await makeRequest('POST', '/api/payments/initialize', paymentPayload, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Initialize Payment', response.status === 200 || response.status === 201, `Status: ${response.status}`);
  } catch (e) {
    logTest('Initialize Payment', false, e.message);
  }

  // Get payment history
  try {
    const response = await makeRequest('GET', '/api/payments?page=1&limit=20', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Get Payment History', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Payment History', false, e.message);
  }
}

// Subscription Tests
async function testSubscriptions() {
  logSection('📋 SUBSCRIPTION TESTS');

  // Get subscription plans
  try {
    const response = await makeRequest('GET', '/api/subscriptions/plans', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Get Subscription Plans', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Subscription Plans', false, e.message);
  }

  // Get user subscription
  try {
    const response = await makeRequest('GET', '/api/subscriptions/my-subscription', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Get User Subscription', response.status === 200 || response.status === 404, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get User Subscription', false, e.message);
  }
}

// Service Requests Tests
async function testServiceRequests() {
  logSection('🛠️  SERVICE REQUESTS TESTS');

  const requestPayload = {
    title: 'Test Service Request',
    description: 'Testing service request functionality',
    category: 'maintenance',
    priority: 'high'
  };

  try {
    const response = await makeRequest('POST', '/api/service-requests', requestPayload, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Create Service Request', response.status === 201 || response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Create Service Request', false, e.message);
  }

  // Get service requests list
  try {
    const response = await makeRequest('GET', '/api/service-requests?page=1&limit=20', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('List Service Requests', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('List Service Requests', false, e.message);
  }
}

// Notification Tests
async function testNotifications() {
  logSection('🔔 NOTIFICATION TESTS');

  // Get notifications
  try {
    const response = await makeRequest('GET', '/api/notifications?page=1&limit=20', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Get Notifications', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Notifications', false, e.message);
  }

  // Mark notifications as read
  try {
    const response = await makeRequest('PUT', '/api/notifications/mark-as-read', { }, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Mark Notifications Read', response.status === 200 || response.status === 404, `Status: ${response.status}`);
  } catch (e) {
    logTest('Mark Notifications Read', false, e.message);
  }
}

// Business Types Tests
async function testBusinessTypes() {
  logSection('🏪 BUSINESS TYPES TESTS');

  // Get business types
  try {
    const response = await makeRequest('GET', '/api/business-types', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Get Business Types', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Business Types', false, e.message);
  }
}

// Billing Tests
async function testBilling() {
  logSection('📊 BILLING TESTS');

  // Get billing items
  try {
    const response = await makeRequest('GET', '/api/billing/items', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Get Billing Items', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Billing Items', false, e.message);
  }

  // Get billing history
  try {
    const response = await makeRequest('GET', '/api/billing/history?page=1&limit=20', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Get Billing History', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Billing History', false, e.message);
  }
}

// Vendor Payout Tests
async function testVendorPayouts() {
  logSection('💸 VENDOR PAYOUT TESTS');

  // Get vendor payouts
  try {
    const response = await makeRequest('GET', '/api/vendor-manager-payout', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Get Vendor Payouts', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Vendor Payouts', false, e.message);
  }
}

// Withdrawal Tests
async function testWithdrawals() {
  logSection('🏦 WITHDRAWAL TESTS');

  // Get withdrawals list
  try {
    const response = await makeRequest('GET', '/api/withdrawals?page=1&limit=20', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Get Withdrawals List', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Withdrawals List', false, e.message);
  }
}

// Distribution Tests
async function testDistribution() {
  logSection('📦 DISTRIBUTION TESTS');

  // Get distributions
  try {
    const response = await makeRequest('GET', '/api/estates/distribution', null, {
      'Authorization': `Bearer ${adminToken}`
    });
    logTest('Get Distributions', response.status === 200, `Status: ${response.status}`);
  } catch (e) {
    logTest('Get Distributions', false, e.message);
  }
}

// Summary Report
function printSummary() {
  const passed = testResults.filter(t => t.passed).length;
  const failed = testResults.filter(t => !t.passed).length;
  const total = testResults.length;
  const passPercentage = ((passed / total) * 100).toFixed(2);

  console.log(`\n${colors.cyan}${colors.bright}═══════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}TEST SUMMARY${colors.reset}${' '.repeat(23)}`);
  console.log(`${colors.cyan}${colors.bright}═══════════════════════════════════${colors.reset}\n`);

  console.log(`${colors.bright}Total Tests:${colors.reset} ${total}`);
  console.log(`${colors.green}${colors.bright}Passed:${colors.reset} ${passed}`);
  console.log(`${colors.red}${colors.bright}Failed:${colors.reset} ${failed}`);
  console.log(`${colors.bright}Success Rate:${colors.reset} ${passPercentage}%\n`);

  if (failed > 0) {
    console.log(`${colors.red}${colors.bright}Failed Tests:${colors.reset}`);
    testResults.filter(t => !t.passed).forEach(t => {
      console.log(`  ${colors.red}❌${colors.reset} ${t.name}${t.details ? ` (${t.details})` : ''}`);
    });
  }

  console.log(`\n${colors.cyan}${colors.bright}═══════════════════════════════════${colors.reset}\n`);
}

// Main test runner
async function runAllTests() {
  console.clear();
  console.log(`\n${colors.blue}${colors.bright}`);
  console.log('  ╔════════════════════════════════════════╗');
  console.log('  ║  🧪 BAMIHUSTLE FEATURE TEST SUITE 🧪  ║');
  console.log('  ╚════════════════════════════════════════╝');
  console.log(`${colors.reset}\n`);

  try {
    await testHealthCheck();
    await testAuthentication();
    await testTenantManagement();
    await testEstateManagement();
    await testUnitManagement();
    await testWallet();
    await testPaymentSystem();
    await testSubscriptions();
    await testServiceRequests();
    await testNotifications();
    await testBusinessTypes();
    await testBilling();
    await testVendorPayouts();
    await testWithdrawals();
    await testDistribution();

    printSummary();
  } catch (error) {
    console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

// Start tests
runAllTests().catch(error => {
  console.error(`${colors.red}Test execution failed: ${error.message}${colors.reset}`);
  process.exit(1);
});
