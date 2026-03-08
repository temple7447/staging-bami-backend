#!/usr/bin/env node

/**
 * VENDOR MANAGER ASSIGNMENT TEST SUITE
 * Tests the complete vendor manager assignment workflow
 * This ensures admins can assign managers to vendors during onboarding
 */

const http = require('http');
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  red: '\x1b[31m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  magenta: '\x1b[35m'
};

const BASE_URL = process.env.BASE_URL || 'http://localhost:5000';
let testResults = [];
let superAdminToken = null;
let managerId = null;
let vendorId = null;
let secondManagerId = null;

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
        'User-Agent': 'VendorManager-Test-Suite',
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
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// Test result logger
function logTest(name, passed, details = '') {
  const status = passed ? `${colors.green}✓ PASS${colors.reset}` : `${colors.red}✗ FAIL${colors.reset}`;
  console.log(`${status} - ${name}`);
  if (details && !passed) console.log(`  ${colors.yellow}Details: ${details}${colors.reset}`);
  testResults.push({ name, passed, details });
}

function printSection(title) {
  console.log(`\n${colors.cyan}${colors.bright}╔═══════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}║ ${title.padEnd(37)} ║${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}╚═══════════════════════════════════════╝${colors.reset}\n`);
}

function printSummary() {
  const total = testResults.length;
  const passed = testResults.filter(r => r.passed).length;
  const failed = total - passed;

  console.log(`\n${colors.cyan}${colors.bright}╔═══════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}║ TEST SUMMARY                          ║${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}╠═══════════════════════════════════════╣${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}║ Total Tests:  ${total.toString().padEnd(22)} ║${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}║ ${colors.green}Passed:       ${passed.toString().padEnd(22)}${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}║ ${colors.red}Failed:       ${failed.toString().padEnd(22)}${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}╚═══════════════════════════════════════╝${colors.reset}`);

  if (failed > 0) {
    console.log(`\n${colors.red}${colors.bright}Failed Tests:${colors.reset}`);
    testResults.filter(r => !r.passed).forEach(r => {
      console.log(`  ${colors.red}✗${colors.reset} ${r.name}`);
      if (r.details) console.log(`    ${colors.yellow}${r.details}${colors.reset}`);
    });
  }

  process.exit(failed > 0 ? 1 : 0);
}

// ============================================
// TEST SUITE
// ============================================

async function runTests() {
  try {
    printSection('VENDOR MANAGER ASSIGNMENT TESTS');

    // =================
    // 1. AUTHENTICATION
    // =================
    printSection('1. Authentication & Setup');

    // Super Admin login
    let response = await makeRequest('POST', '/api/auth/login', {
      email: process.env.SUPER_ADMIN_EMAIL || 'admin@bamihustle.com',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin123!'
    });

    const loginSuccess = response.status === 200 && response.body.success && response.body.data.token;
    logTest('Super Admin Login', loginSuccess, 
      loginSuccess ? '' : `Status: ${response.status}, Success: ${response.body?.success}`);

    if (!loginSuccess) {
      console.error(`${colors.red}Cannot proceed without authentication${colors.reset}`);
      printSummary();
      return;
    }

    superAdminToken = response.body.data.token;
    console.log(`${colors.green}✓ Authentication token obtained${colors.reset}\n`);

    // ====================
    // 2. GET AVAILABLE MANAGERS
    // ====================
    printSection('2. Fetch Available Managers');

    response = await makeRequest('GET', '/api/auth/managers', null, {
      'Authorization': `Bearer ${superAdminToken}`
    });

    const getManagersSuccess = response.status === 200 && response.body.success && Array.isArray(response.body.data);
    logTest('Get Available Managers', getManagersSuccess,
      getManagersSuccess ? '' : `Status: ${response.status}`);

    if (getManagersSuccess && response.body.data.length > 0) {
      managerId = response.body.data[0]._id;
      console.log(`${colors.green}✓ Found ${response.body.data.length} manager(s)${colors.reset}`);
      console.log(`${colors.magenta}  Using Manager: ${response.body.data[0].name} (${managerId})${colors.reset}`);
      
      // Get a second manager if available for update test
      if (response.body.data.length > 1) {
        secondManagerId = response.body.data[1]._id;
        console.log(`${colors.magenta}  Second Manager: ${response.body.data[1].name} (${secondManagerId})${colors.reset}\n`);
      }
    } else {
      console.warn(`${colors.yellow}No managers found. You need to create at least one manager first.${colors.reset}`);
      console.warn(`${colors.yellow}Create a manager via: POST /api/auth/onboard-manager${colors.reset}\n`);
    }

    if (!managerId) {
      console.error(`${colors.red}Cannot proceed without a manager${colors.reset}`);
      printSummary();
      return;
    }

    // ========================
    // 3. ONBOARD VENDOR WITH MANAGER (POSITIVE CASES)
    // ========================
    printSection('3. Vendor Onboarding with Manager Assignment');

    // Test 3.1: Onboard vendor with valid manager
    const vendorData = {
      name: 'Test Vendor Manager Mode',
      email: `vendor_test_${Date.now()}@test.com`,
      phone: '+2348123456789',
      position: 'Senior Electrician',
      managerId: managerId,
      sendCredentials: true
    };

    response = await makeRequest('POST', '/api/auth/onboard-vendor', vendorData, {
      'Authorization': `Bearer ${superAdminToken}`
    });

    const onboardSuccess = response.status === 201 && response.body.success && response.body.data._id;
    logTest('Onboard Vendor with Manager', onboardSuccess,
      onboardSuccess ? '' : `Status: ${response.status}, Message: ${response.body?.message}`);

    if (onboardSuccess) {
      vendorId = response.body.data._id;
      console.log(`${colors.magenta}  Vendor ID: ${vendorId}${colors.reset}`);
      console.log(`${colors.magenta}  Email: ${response.body.data.email}${colors.reset}\n`);

      // Verify manager is assigned in response
      const managerAssignedInResponse = response.body.data.manager && response.body.data.manager._id === managerId;
      logTest('Manager Assigned in Response', managerAssignedInResponse,
        managerAssignedInResponse ? '' : `Manager not in response or ID mismatch`);
    }

    // Test 3.2: Verify vendor was created with manager
    if (vendorId) {
      response = await makeRequest('GET', `/api/auth/vendors/${vendorId}`, null, {
        'Authorization': `Bearer ${superAdminToken}`
      });

      const vendorCreated = response.status === 200 && response.body.data.role === 'vendor';
      logTest('Vendor Created Successfully', vendorCreated,
        vendorCreated ? '' : `Status: ${response.status}`);

      if (vendorCreated) {
        const managerVerified = response.body.data.manager && response.body.data.manager._id === managerId;
        logTest('Manager Correctly Assigned to Vendor', managerVerified,
          managerVerified ? '' : `Expected manager ${managerId}, got ${response.body.data.manager?._id}`);
        console.log(`${colors.green}  Vendor Manager: ${response.body.data.manager?.name}${colors.reset}\n`);
      }
    }

    // ========================
    // 4. VENDOR CREATION VALIDATION (NEGATIVE CASES)
    // ========================
    printSection('4. Validation Tests (Error Cases)');

    // Test 4.1: Onboard vendor WITHOUT manager (should fail)
    const vendorNoManager = {
      name: 'Test Vendor No Manager',
      email: `vendor_nomanager_${Date.now()}@test.com`,
      phone: '+2348123456789'
    };

    response = await makeRequest('POST', '/api/auth/onboard-vendor', vendorNoManager, {
      'Authorization': `Bearer ${superAdminToken}`
    });

    const noManagerValidation = response.status === 400 && !response.body.success;
    logTest('Reject Vendor without Manager (Validation)', noManagerValidation,
      noManagerValidation ? '' : `Should return 400, got ${response.status}`);
    if (noManagerValidation) {
      console.log(`${colors.green}  Error message: ${response.body.message}${colors.reset}`);
    }

    // Test 4.2: Onboard vendor with INVALID manager ID
    const vendorInvalidManager = {
      name: 'Test Vendor Invalid Manager',
      email: `vendor_invalidmgr_${Date.now()}@test.com`,
      phone: '+2348123456789',
      managerId: '000000000000000000000000' // Invalid ObjectId
    };

    response = await makeRequest('POST', '/api/auth/onboard-vendor', vendorInvalidManager, {
      'Authorization': `Bearer ${superAdminToken}`
    });

    const invalidManagerValidation = response.status === 400 && !response.body.success;
    logTest('Reject Vendor with Invalid Manager ID', invalidManagerValidation,
      invalidManagerValidation ? '' : `Should return 400, got ${response.status}`);
    if (invalidManagerValidation) {
      console.log(`${colors.green}  Error message: ${response.body.message}${colors.reset}`);
    }

    // Test 4.3: Duplicate email should fail
    if (vendorId) {
      response = await makeRequest('POST', '/api/auth/onboard-vendor', {
        name: 'Duplicate Email Test',
        email: vendorData.email,
        managerId: managerId
      }, {
        'Authorization': `Bearer ${superAdminToken}`
      });

      const duplicateValidation = response.status === 400 && !response.body.success;
      logTest('Reject Vendor with Duplicate Email', duplicateValidation,
        duplicateValidation ? '' : `Should return 400, got ${response.status}`);
      if (duplicateValidation) {
        console.log(`${colors.green}  Error message: ${response.body.message}${colors.reset}`);
      }
    }

    console.log();

    // ========================
    // 5. UPDATE VENDOR MANAGER
    // ========================
    printSection('5. Update Vendor Manager Assignment');

    if (vendorId && secondManagerId) {
      response = await makeRequest('PUT', `/api/auth/vendor/${vendorId}`, {
        managerId: secondManagerId
      }, {
        'Authorization': `Bearer ${superAdminToken}`
      });

      const updateSuccess = response.status === 200 && response.body.success;
      logTest('Update Vendor Manager', updateSuccess,
        updateSuccess ? '' : `Status: ${response.status}`);

      if (updateSuccess) {
        const newManagerCorrect = response.body.data.manager._id === secondManagerId;
        logTest('New Manager Assigned Correctly', newManagerCorrect,
          newManagerCorrect ? '' : `Expected ${secondManagerId}, got ${response.body.data.manager._id}`);
        console.log(`${colors.green}  New Manager: ${response.body.data.manager.name}${colors.reset}\n`);
      }
    } else if (!secondManagerId) {
      console.log(`${colors.yellow}⊘ SKIP - Only one manager available for update test${colors.reset}\n`);
    }

    // ========================
    // 6. GET VENDORS WITH MANAGERS
    // ========================
    printSection('6. Fetch Vendors and Verify Manager Association');

    response = await makeRequest('GET', '/api/auth/vendors', null, {
      'Authorization': `Bearer ${superAdminToken}`
    });

    const getVendorsSuccess = response.status === 200 && response.body.success && Array.isArray(response.body.data);
    logTest('Get All Vendors', getVendorsSuccess,
      getVendorsSuccess ? '' : `Status: ${response.status}`);

    if (getVendorsSuccess) {
      const vendorsWithManagers = response.body.data.filter(v => v.manager);
      console.log(`${colors.green}  Total vendors: ${response.body.data.length}${colors.reset}`);
      console.log(`${colors.green}  Vendors with managers: ${vendorsWithManagers.length}${colors.reset}\n`);
    }

    // ========================
    // 7. WORKFLOW TEST
    // ========================
    printSection('7. Complete Workflow Test');

    // Create a test vendor end-to-end
    const workflowVendor = {
      name: `Workflow Test Vendor ${Date.now()}`,
      email: `workflow_vendor_${Date.now()}@test.com`,
      phone: '+2347000000000',
      position: 'Test Specialist',
      managerId: managerId
    };

    response = await makeRequest('POST', '/api/auth/onboard-vendor', workflowVendor, {
      'Authorization': `Bearer ${superAdminToken}`
    });

    const workflowVendorCreated = response.status === 201 && response.body.success;
    logTest('Step 1: Create Vendor with Manager', workflowVendorCreated);

    if (workflowVendorCreated) {
      const newVendorId = response.body.data._id;

      // Fetch the vendor
      response = await makeRequest('GET', `/api/auth/vendors/${newVendorId}`, null, {
        'Authorization': `Bearer ${superAdminToken}`
      });

      const workflowVendorFetched = response.status === 200 && response.body.data.role === 'vendor';
      logTest('Step 2: Fetch Vendor Details', workflowVendorFetched);

      if (workflowVendorFetched) {
        const managerStillAssigned = response.body.data.manager && response.body.data.manager._id === managerId;
        logTest('Step 3: Verify Manager Still Assigned', managerStillAssigned);
        console.log(`${colors.green}✓ Complete workflow successful${colors.reset}\n`);
      }
    }

    // All tests completed
    printSummary();

  } catch (error) {
    console.error(`${colors.red}Test suite error: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

// Start tests
console.log(`${colors.bright}${colors.cyan}BamiHustle - Vendor Manager Assignment Test Suite${colors.reset}`);
console.log(`${colors.cyan}Base URL: ${BASE_URL}${colors.reset}`);
console.log(`${colors.cyan}Starting tests...${colors.reset}`);

runTests();
