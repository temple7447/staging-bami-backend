#!/usr/bin/env node

/**
 * VENDOR MANAGER ASSIGNMENT - SETUP & VERIFICATION SCRIPT
 * This script:
 * 1. Connects directly to MongoDB
 * 2. Creates test data if needed (super admin, managers)
 * 3. Runs API tests against the running server
 */

const mongoose = require('mongoose');
const http = require('http');
const dotenv = require('dotenv');
const path = require('path');

// Load env vars
dotenv.config({ path: path.join(__dirname, '../.env') });

const User = require('../models/User');
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

const BASE_URL = 'http://localhost:5000';
let testResults = [];
let superAdminToken = null;
let superAdminId = null;
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

// Setup function - ensure we have test data
async function setupTestData() {
  try {
    printSection('SETUP: Creating Test Data');

    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI);
    console.log(`${colors.green}✓ Connected to MongoDB${colors.reset}\n`);

    // Check if super admin exists
    let superAdmin = await User.findOne({ role: 'super_admin' });
    if (!superAdmin) {
      console.log(`${colors.yellow}⊘ Super Admin not found. Creating...${colors.reset}`);
      superAdmin = await User.create({
        name: 'Super Administrator',
        email: 'test_super_admin@bamihustle.com',
        password: 'SuperAdmin123!',
        role: 'super_admin',
        emailVerified: true,
        isActive: true
      });
      console.log(`${colors.green}✓ Super Admin created: ${superAdmin.email}${colors.reset}\n`);
    } else {
      console.log(`${colors.green}✓ Super Admin found: ${superAdmin.email}${colors.reset}\n`);
    }

    superAdminId = superAdmin._id;

    // Check if we have at least one manager
    let managers = await User.find({ role: 'manager' }).limit(2);
    if (managers.length === 0) {
      console.log(`${colors.yellow}⊘ No managers found. Creating...${colors.reset}`);
      const manager1 = await User.create({
        name: 'Test Manager One',
        email: `test_manager_1_${Date.now()}@bamihustle.com`,
        password: 'Manager123!',
        role: 'manager',
        phone: '+2348000000001',
        createdBy: superAdminId,
        emailVerified: true,
        isActive: true
      });
      console.log(`${colors.green}✓ Manager 1 created: ${manager1.email}${colors.reset}`);
      managers.push(manager1);

      const manager2 = await User.create({
        name: 'Test Manager Two',
        email: `test_manager_2_${Date.now()}@bamihustle.com`,
        password: 'Manager123!',
        role: 'manager',
        phone: '+2348000000002',
        createdBy: superAdminId,
        emailVerified: true,
        isActive: true
      });
      console.log(`${colors.green}✓ Manager 2 created: ${manager2.email}${colors.reset}`);
      managers.push(manager2);
    } else {
      console.log(`${colors.green}✓ Found ${managers.length} manager(s)${colors.reset}`);
    }

    managerId = managers[0]._id;
    if (managers.length > 1) {
      secondManagerId = managers[1]._id;
    }

    console.log(`${colors.green}✓ Test data ready${colors.reset}\n`);
    await mongoose.connection.close();
  } catch (error) {
    console.error(`${colors.red}✗ Setup error: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

// ============================================
// TEST SUITE
// ============================================

async function runTests() {
  try {
    printSection('VENDOR MANAGER ASSIGNMENT API TESTS');

    // =================
    // 1. AUTHENTICATION
    // =================
    printSection('1. Authentication & Setup');

    // Super Admin login - try multiple credentials
    let response = await makeRequest('POST', '/api/auth/login', {
      email: 'test_admin@bamihustle.com',
      password: 'TestAdmin123!'
    });

    if (response.status !== 200) {
      // If first password fails, try alternatives
      console.warn(`${colors.yellow}First credential attempt failed, trying alternative...${colors.reset}`);
      response = await makeRequest('POST', '/api/auth/login', {
        email: 'starukido@gmail.com',
        password: 'SuperAdmin123!'
      });
    }

    const loginSuccess = response.status === 200 && response.body.success && response.body.token;
    logTest('Super Admin Login', loginSuccess, 
      loginSuccess ? '' : `Status: ${response.status}, Success: ${response.body?.success}`);

    if (!loginSuccess) {
      console.error(`${colors.red}Cannot proceed without authentication${colors.reset}\n`);
      console.error(`Response:`, JSON.stringify(response.body, null, 2));
      printSummary();
      return;
    }

    superAdminToken = response.body.token;
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
      console.log(`${colors.green}✓ Found ${response.body.data.length} manager(s)${colors.reset}`);
      response.body.data.forEach((mgr, idx) => {
        console.log(`${colors.magenta}  ${idx + 1}. ${mgr.name} (${mgr.email}) - ${mgr.role}${colors.reset}`);
      });
      console.log();
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

    const vendorData = {
      name: 'Test Vendor Manager Mode',
      email: `vendor_test_${Date.now()}@test.com`,
      phone: '+2348123456789',
      position: 'Senior Electrician',
      managerId: managerId,
      sendCredentials: false
    };

    response = await makeRequest('POST', '/api/auth/onboard-vendor', vendorData, {
      'Authorization': `Bearer ${superAdminToken}`
    });

    const onboardSuccess = response.status === 201 && response.body.success && response.body.data && response.body.data.id;
    logTest('Onboard Vendor with Manager', onboardSuccess,
      onboardSuccess ? '' : `Status: ${response.status}, Success: ${response.body?.success}, Data: ${JSON.stringify(response.body?.data)}`);

    if (onboardSuccess) {
      vendorId = response.body.data.id || response.body.data._id;
      console.log(`${colors.magenta}  Vendor ID: ${vendorId}${colors.reset}`);
      console.log(`${colors.magenta}  Email: ${response.body.data.email}${colors.reset}`);
      console.log(`${colors.magenta}  Manager: ${response.body.data.manager?.name || 'N/A (will be verified in fetch)'}${colors.reset}\n`);

      // Manager might not be fully populated in creation response if it's lazy-loaded
      // So we skip this check here and verify it in the fetch test instead
    }

    // Test 3.2: Verify vendor was created with manager
    if (vendorId) {
      response = await makeRequest('GET', `/api/auth/vendors?limit=100`, null, {
        'Authorization': `Bearer ${superAdminToken}`
      });

      const vendorCreated = response.status === 200 && response.body.success && response.body.data.length > 0;
      logTest('Fetch Vendors List', vendorCreated,
        vendorCreated ? '' : `Status: ${response.status}`);

      if (vendorCreated) {
        const createdVendor = response.body.data.find(v => v._id === vendorId);
        const managerVerified = createdVendor && createdVendor.manager && createdVendor.manager._id === managerId.toString();
        logTest('Manager Correctly Assigned to Vendor', managerVerified,
          managerVerified ? '' : `Expected manager ${managerId}, got ${createdVendor?.manager?._id}`);
        if (createdVendor) {
          console.log(`${colors.green}  Vendor: ${createdVendor.name}${colors.reset}`);
          console.log(`${colors.green}  Manager: ${createdVendor.manager?.name}${colors.reset}\n`);
        }
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
      console.log(`${colors.green}  Error: ${response.body.message}${colors.reset}\n`);
    }

    // Test 4.2: Onboard vendor with INVALID manager ID
    const vendorInvalidManager = {
      name: 'Test Vendor Invalid Manager',
      email: `vendor_invalidmgr_${Date.now()}@test.com`,
      phone: '+2348123456789',
      managerId: '000000000000000000000000'
    };

    response = await makeRequest('POST', '/api/auth/onboard-vendor', vendorInvalidManager, {
      'Authorization': `Bearer ${superAdminToken}`
    });

    const invalidManagerValidation = response.status === 400 && !response.body.success;
    logTest('Reject Vendor with Invalid Manager ID', invalidManagerValidation,
      invalidManagerValidation ? '' : `Should return 400, got ${response.status}`);
    if (invalidManagerValidation) {
      console.log(`${colors.green}  Error: ${response.body.message}${colors.reset}\n`);
    }

    // ========================
    // 5. UPDATE VENDOR MANAGER
    // ========================
    if (vendorId && secondManagerId) {
      printSection('5. Update Vendor Manager Assignment');

      response = await makeRequest('PUT', `/api/auth/vendor/${vendorId}`, {
        managerId: secondManagerId
      }, {
        'Authorization': `Bearer ${superAdminToken}`
      });

      const updateSuccess = response.status === 200 && response.body.success;
      logTest('Update Vendor Manager', updateSuccess,
        updateSuccess ? '' : `Status: ${response.status}`);

      if (updateSuccess) {
        const newManagerCorrect = response.body.data.manager._id === secondManagerId.toString();
        logTest('New Manager Assigned Correctly', newManagerCorrect,
          newManagerCorrect ? '' : `Expected ${secondManagerId}, got ${response.body.data.manager._id}`);
        console.log(`${colors.green}✓ New Manager: ${response.body.data.manager.name}${colors.reset}\n`);
      }
    }

    // All tests completed
    printSummary();

  } catch (error) {
    console.error(`${colors.red}Test suite error: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

// Main execution
async function main() {
  console.log(`${colors.bright}${colors.cyan}BamiHustle - Vendor Manager Assignment Test${colors.reset}`);
  console.log(`${colors.cyan}Setup + API Verification${colors.reset}\n`);

  try {
    await setupTestData();
    await runTests();
  } catch (error) {
    console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

main();
