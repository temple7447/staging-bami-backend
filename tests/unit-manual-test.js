#!/usr/bin/env node

/**
 * Manual Unit API Test Runner
 * Test all unit endpoints against MongoDB Database
 * Usage: node tests/unit-manual-test.js
 */

const axios = require('axios');
const colors = require('colors');

const BASE_URL = process.env.API_URL || 'http://localhost:5000';
const AUTH_TOKEN = process.env.TEST_AUTH_TOKEN || 'your-test-token-here';

let testResults = {
  passed: 0,
  failed: 0,
  endpoints: []
};

/**
 * Test helper function
 */
async function testEndpoint(method, endpoint, data = null, shouldHaveAuth = true) {
  try {
    const config = {
      method,
      url: `${BASE_URL}${endpoint}`,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (shouldHaveAuth) {
      config.headers.Authorization = `Bearer ${AUTH_TOKEN}`;
    }

    if (data) {
      config.data = data;
    }

    const response = await axios(config);
    
    testResults.passed++;
    testResults.endpoints.push({
      method,
      endpoint,
      status: response.status,
      result: '✅ PASS'
    });

    console.log(`${colors.green('✅')} ${method.padEnd(6)} ${endpoint.padEnd(60)} ${response.status}`);
    return response.data;
  } catch (error) {
    testResults.failed++;
    testResults.endpoints.push({
      method,
      endpoint,
      status: error.response?.status || 'ERROR',
      result: '❌ FAIL',
      error: error.message
    });

    console.log(`${colors.red('❌')} ${method.padEnd(6)} ${endpoint.padEnd(60)} ${error.response?.status || 'ERROR'}`);
    return null;
  }
}

/**
 * Run all tests
 */
async function runTests() {
  console.log(colors.cyan('\n' + '='.repeat(80)));
  console.log(colors.cyan('🧪 UNIT API ENDPOINT TESTS - MongoDB Database'));
  console.log(colors.cyan('='.repeat(80) + '\n'));

  // Sample estate and unit IDs (replace with real ones from your database)
  const estateId = 'sample-estate-id';
  const unitId = 'sample-unit-id';

  console.log(colors.yellow('\n📝 Testing Basic Unit Endpoints:\n'));

  // Test: Create Unit
  await testEndpoint('POST', `/api/units/${estateId}/units`, {
    label: 'Test Unit 1',
    rentAmount: 150000,
    serviceChargeAmount: 5000,
    description: 'Test unit created at ' + new Date().toISOString()
  });

  // Test: Get All Units
  await testEndpoint('GET', `/api/units/${estateId}/units`);

  // Test: Get Units with Pagination
  await testEndpoint('GET', `/api/units/${estateId}/units/search?page=1&limit=10`);

  // Test: Get Unit Statistics
  await testEndpoint('GET', `/api/units/${estateId}/units/stats`);

  // Test: Get Vacant Units
  await testEndpoint('GET', `/api/units/${estateId}/units/vacant`);

  // Test: Get Occupied Units
  await testEndpoint('GET', `/api/units/${estateId}/units/occupied`);

  // Test: Get Unit Details
  await testEndpoint('GET', `/api/units/unit/${unitId}`);

  console.log(colors.yellow('\n📝 Testing Filter & Search Endpoints:\n'));

  // Test: Search Units
  await testEndpoint('GET', `/api/units/${estateId}/units/search/Unit`);

  // Test: Filter by Status
  await testEndpoint('GET', `/api/units/${estateId}/units/search?status=vacant&page=1&limit=10`);

  console.log(colors.yellow('\n📝 Testing Unit Modification Endpoints:\n'));

  // Test: Update Unit
  await testEndpoint('PUT', `/api/units/unit/${unitId}`, {
    label: 'Updated Test Unit',
    rentAmount: 160000,
    serviceChargeAmount: 6000
  });

  // Test: Bulk Create Units
  await testEndpoint('POST', `/api/units/${estateId}/units/bulk`, {
    units: [
      { label: 'Bulk Unit 1', rentAmount: 100000 },
      { label: 'Bulk Unit 2', rentAmount: 120000 },
      { label: 'Bulk Unit 3', rentAmount: 140000 }
    ]
  });

  console.log(colors.yellow('\n📝 Testing Tenant Assignment Endpoints:\n'));

  // Test: Assign Tenant (requires valid tenantId)
  const tenantId = 'sample-tenant-id';
  await testEndpoint('POST', `/api/units/${estateId}/units/${unitId}/assign-tenant`, {
    tenantId: tenantId
  });

  // Test: Remove Tenant
  await testEndpoint('POST', `/api/units/${estateId}/units/${unitId}/remove-tenant`);

  console.log(colors.yellow('\n📝 Testing Public Endpoints (No Auth):\n'));

  // Test: Get Public Listings
  await testEndpoint('GET', `/api/units/public/listings`, null, false);

  // Test: Get Public Listing Detail
  await testEndpoint('GET', `/api/units/public/listings/${unitId}`, null, false);

  console.log(colors.yellow('\n📝 Testing Deletion Endpoints:\n'));

  // Test: Delete Unit
  await testEndpoint('DELETE', `/api/units/unit/${unitId}`);

  console.log(colors.cyan('\n' + '='.repeat(80)));
  console.log(colors.cyan('📊 TEST RESULTS'));
  console.log(colors.cyan('='.repeat(80)));
  console.log(colors.green(`✅ Passed: ${testResults.passed}`));
  console.log(colors.red(`❌ Failed: ${testResults.failed}`));
  console.log(colors.cyan(`📈 Total: ${testResults.passed + testResults.failed}`));
  console.log(colors.cyan('='.repeat(80) + '\n'));

  // Detailed results
  console.log(colors.yellow('📋 Detailed Results:\n'));
  testResults.endpoints.forEach(ep => {
    const statusColor = ep.result.includes('PASS') ? colors.green : colors.red;
    console.log(`${statusColor(ep.result)} | ${ep.method.padEnd(6)} | ${ep.endpoint.padEnd(50)} | Status: ${ep.status}`);
    if (ep.error) {
      console.log(`   Error: ${ep.error}`);
    }
  });

  console.log('\n');
}

// Run tests
if (require.main === module) {
  runTests().catch(error => {
    console.error(colors.red('Test runner error:'), error);
    process.exit(1);
  });
}

module.exports = { testEndpoint, testResults };
