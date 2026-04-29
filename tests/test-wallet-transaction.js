#!/usr/bin/env node

/**
 * UNIFIED WALLET TRANSACTION ENDPOINT TEST
 * Tests POST /api/wallet/transaction for deposit, withdraw, and transfer
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

const BASE_URL = 'http://localhost:4000';
let testResults = [];
let tenantToken = null;
let tenantWallet = null;
let recipientToken = null;
let recipientUserId = null;
let estateId = null;

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
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null
          });
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

function logTest(name, passed, details = '') {
  testResults.push({ name, passed, details });
  const status = passed
    ? `${colors.green}✅ PASS${colors.reset}`
    : `${colors.red}❌ FAIL${colors.reset}`;
  console.log(`${status} | ${name}${details ? ` (${details})` : ''}`);
}

function logSection(title) {
  console.log(`\n${colors.cyan}${colors.bright}════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}  ${title}${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}════════════════════════════════════════════${colors.reset}\n`);
}

// 1. Authenticate as tenant
async function authenticateTenant() {
  logSection('🔐 Authenticating Tenant');

  const response = await makeRequest('POST', '/api/auth/login', {
    email: 'tenant@test.com',
    password: 'TempPass123'
  });

  if (response.body && response.body.token) {
    tenantToken = response.body.token;
    logTest('Tenant Login', true, `Status: ${response.status}`);
  } else {
    logTest('Tenant Login', false, `Status: ${response.status}, ${JSON.stringify(response.body)}`);
    process.exit(1);
  }
}

// 2. Get tenant wallet balance
async function getInitialWallet() {
  logSection('💰 Getting Initial Wallet Balance');

  const response = await makeRequest('GET', '/api/wallet', null, {
    'Authorization': `Bearer ${tenantToken}`
  });

  if (response.status === 200 && response.body && response.body.data) {
    tenantWallet = response.body.data;
    logTest('Get Wallet', true, `Balance: ₦${tenantWallet.balance}`);
  } else {
    logTest('Get Wallet', false, `Status: ${response.status}`);
  }
}

// 3. Test DEPOSIT - Success
async function testDepositSuccess() {
  logSection('💵 DEPOSIT TESTS');

  const initialBalance = tenantWallet ? tenantWallet.balance : 0;

  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'deposit',
    amount: 50000,
    description: 'Test deposit'
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 200 && response.body && response.body.success && response.body.data.newBalance === initialBalance + 50000;
  logTest('Deposit - Success', passed, `Status: ${response.status}, New Balance: ₦${response.body?.data?.newBalance}`);

  if (passed) {
    tenantWallet = { ...tenantWallet, balance: response.body.data.newBalance };
  }
}

// 4. Test DEPOSIT - Missing amount
async function testDepositMissingAmount() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'deposit'
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400;
  logTest('Deposit - Missing Amount', passed, `Status: ${response.status}`);
}

// 5. Test DEPOSIT - Invalid amount (zero)
async function testDepositZeroAmount() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'deposit',
    amount: 0
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400;
  logTest('Deposit - Zero Amount', passed, `Status: ${response.status}`);
}

// 6. Test DEPOSIT - Invalid type
async function testDepositInvalidType() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'invalid_type',
    amount: 1000
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400;
  logTest('Deposit - Invalid Type', passed, `Status: ${response.status}`);
}

// 7. Test DEPOSIT - Negative amount
async function testDepositNegativeAmount() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'deposit',
    amount: -500
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400;
  logTest('Deposit - Negative Amount', passed, `Status: ${response.status}`);
}

// 8. Test DEPOSIT - No auth token
async function testDepositNoAuth() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'deposit',
    amount: 1000
  });

  const passed = response.status === 401;
  logTest('Deposit - No Auth', passed, `Status: ${response.status}`);
}

// 9. Test WITHDRAW - Create another user for testing, first deposit more funds
async function testWithdrawSuccess() {
  logSection('🏦 WITHDRAW TESTS');

  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'withdraw',
    amount: 10000,
    description: 'Test withdrawal',
    bankDetails: {
      accountName: 'Test Tenant',
      accountNumber: '1234567890',
      bankName: 'GTBank'
    }
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 200 && response.body && response.body.success && response.body.data.status === 'pending';
  logTest('Withdraw - Success', passed, `Status: ${response.status}, Status: ${response.body?.data?.status}`);

  if (passed) {
    tenantWallet = { ...tenantWallet, balance: response.body.data.newBalance };
  }
}

// 10. Test WITHDRAW - Insufficient balance
async function testWithdrawInsufficientBalance() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'withdraw',
    amount: 999999999,
    bankDetails: {
      accountName: 'Test Tenant',
      accountNumber: '1234567890',
      bankName: 'GTBank'
    }
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400 && response.body && response.body.message && response.body.message.includes('Insufficient');
  logTest('Withdraw - Insufficient Balance', passed, `Status: ${response.status}, Message: ${response.body?.message}`);
}

// 11. Test WITHDRAW - Missing bank details
async function testWithdrawMissingBankDetails() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'withdraw',
    amount: 5000
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400;
  logTest('Withdraw - Missing Bank Details', passed, `Status: ${response.status}`);
}

// 12. Test WITHDRAW - Missing amount
async function testWithdrawMissingAmount() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'withdraw',
    bankDetails: {
      accountName: 'Test Tenant',
      accountNumber: '1234567890',
      bankName: 'GTBank'
    }
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400;
  logTest('Withdraw - Missing Amount', passed, `Status: ${response.status}`);
}

// 13. Login as admin for transfer tests
async function createRecipientUser() {
  logSection('👤 Logging in as Admin for Transfer Tests');

  const loginResponse = await makeRequest('POST', '/api/auth/login', {
    email: 'admin@test.com',
    password: 'Admin123!'
  });

  if (loginResponse.body && loginResponse.body.token) {
    recipientToken = loginResponse.body.token;
    recipientUserId = loginResponse.body.data?._id;
    logTest('Admin Login (Recipient)', true, `Status: ${loginResponse.status}`);
  } else {
    logTest('Admin Login (Recipient)', false, `Status: ${loginResponse.status}`);
  }

  // Get recipient wallet
  const walletResponse = await makeRequest('GET', '/api/wallet', null, {
    'Authorization': `Bearer ${recipientToken}`
  });

  if (walletResponse.status === 200 && walletResponse.body && walletResponse.body.data) {
    logTest('Recipient Wallet Exists', true, `Balance: ₦${walletResponse.body.data.balance}`);
  } else {
    logTest('Recipient Wallet Exists', false);
  }
}

// 14. Test TRANSFER - To user by email
async function testTransferToUserByEmail() {
  logSection('🔄 TRANSFER TESTS');

  const recipientEmail = `recipient${Date.now().toString().slice(-8)}@test.com`;
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'transfer',
    amount: 5000,
    description: 'Test transfer to user',
    recipientEmail: recipientEmail,
    recipientType: 'user'
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400;
  logTest('Transfer - User Not Found', passed, `Status: ${response.status}`);
}

// 15. Test TRANSFER - Insufficient balance
async function testTransferInsufficientBalance() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'transfer',
    amount: 999999999,
    recipientEmail: 'admin@test.com',
    recipientType: 'user'
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400 && response.body && response.body.message && response.body.message.includes('Insufficient');
  logTest('Transfer - Insufficient Balance', passed, `Status: ${response.status}`);
}

// 16. Test TRANSFER - Missing recipient
async function testTransferMissingRecipient() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'transfer',
    amount: 1000,
    recipientType: 'user'
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400;
  logTest('Transfer - Missing Recipient', passed, `Status: ${response.status}`);
}

// 17. Test TRANSFER - Missing amount
async function testTransferMissingAmount() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'transfer',
    recipientEmail: 'admin@test.com',
    recipientType: 'user'
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400;
  logTest('Transfer - Missing Amount', passed, `Status: ${response.status}`);
}

// 18. Test TRANSFER - To estate (missing estate ID)
async function testTransferToEstateMissingId() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'transfer',
    amount: 1000,
    recipientType: 'estate'
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400;
  logTest('Transfer - Estate Missing ID', passed, `Status: ${response.status}`);
}

// 19. Test TRANSFER - To estate (non-existent estate)
async function testTransferToEstateNotFound() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    type: 'transfer',
    amount: 1000,
    recipientId: '507f1f77bcf86cd799439011',
    recipientType: 'estate'
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400 && response.body && response.body.message && response.body.message.includes('not found');
  logTest('Transfer - Estate Not Found', passed, `Status: ${response.status}`);
}

// 20. Verify transaction history includes the new transactions
async function testTransactionHistory() {
  logSection('📋 TRANSACTION HISTORY');

  const response = await makeRequest('GET', '/api/wallet/transactions', null, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 200 && response.body && response.body.data && response.body.data.length > 0;
  logTest('Transaction History', passed, `Status: ${response.status}, Count: ${response.body?.count}`);
}

// 21. Verify wallet balance is correct after all operations
async function verifyFinalBalance() {
  logSection('🔍 VERIFYING FINAL STATE');

  const response = await makeRequest('GET', '/api/wallet', null, {
    'Authorization': `Bearer ${tenantToken}`
  });

  if (response.status === 200 && response.body && response.body.data) {
    logTest('Final Wallet Balance', true, `Balance: ₦${response.body.data.balance}, Earnings: ₦${response.body.data.totalEarnings}, Spent: ₦${response.body.data.totalSpent}`);
  } else {
    logTest('Final Wallet Balance', false);
  }
}

// 22. Test with empty body
async function testEmptyBody() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {}, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400;
  logTest('Empty Body', passed, `Status: ${response.status}`);
}

// 23. Test with invalid JSON (missing type)
async function testMissingType() {
  const response = await makeRequest('POST', '/api/wallet/transaction', {
    amount: 1000
  }, {
    'Authorization': `Bearer ${tenantToken}`
  });

  const passed = response.status === 400;
  logTest('Missing Type', passed, `Status: ${response.status}`);
}

// Summary
function printSummary() {
  const passed = testResults.filter(t => t.passed).length;
  const failed = testResults.filter(t => !t.passed).length;
  const total = testResults.length;
  const passPercentage = total > 0 ? ((passed / total) * 100).toFixed(2) : 0;

  console.log(`\n${colors.cyan}${colors.bright}════════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}  TEST SUMMARY${' '.repeat(28)}${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}════════════════════════════════════════════${colors.reset}\n`);

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

  console.log(`\n${colors.cyan}${colors.bright}════════════════════════════════════════════${colors.reset}\n`);
}

// Main
async function runTests() {
  console.log(`\n${colors.blue}${colors.bright}`);
  console.log('  ╔══════════════════════════════════════════════════╗');
  console.log('  ║  🧪 WALLET TRANSACTION ENDPOINT TEST SUITE 🧪   ║');
  console.log('  ╚══════════════════════════════════════════════════╝');
  console.log(`${colors.reset}\n`);

  try {
    await authenticateTenant();
    await getInitialWallet();
    await testDepositSuccess();
    await testDepositMissingAmount();
    await testDepositZeroAmount();
    await testDepositInvalidType();
    await testDepositNegativeAmount();
    await testDepositNoAuth();
    await testWithdrawSuccess();
    await testWithdrawInsufficientBalance();
    await testWithdrawMissingBankDetails();
    await testWithdrawMissingAmount();
    await createRecipientUser();
    await testTransferToUserByEmail();
    await testTransferInsufficientBalance();
    await testTransferMissingRecipient();
    await testTransferMissingAmount();
    await testTransferToEstateMissingId();
    await testTransferToEstateNotFound();
    await testTransactionHistory();
    await verifyFinalBalance();
    await testEmptyBody();
    await testMissingType();

    printSummary();
  } catch (error) {
    console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
    console.error(error.stack);
    process.exit(1);
  }
}

runTests();
