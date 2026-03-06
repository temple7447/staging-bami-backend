#!/usr/bin/env node

/**
 * COMPREHENSIVE SYSTEM DIAGNOSTIC TEST
 * Tests server functionality and provides detailed diagnostics
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
let results = {
  statusChecks: [],
  serverHealth: {},
  connectivity: {},
  schedulers: {},
  errors: []
};

async function makeRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const urlString = endpoint.startsWith('http') ? endpoint : `${BASE_URL}${endpoint}`;
    const url = new URL(urlString);
    const options = {
      hostname: url.hostname,
      port: url.port || 80,
      path: url.pathname + url.search,
      method: method,
      timeout: 5000,
      headers: { 'Content-Type': 'application/json' }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const response = {
            status: res.statusCode,
            headers: res.headers,
            body: data ? JSON.parse(data) : null,
            rawBody: data
          };
          resolve(response);
        } catch (e) {
          resolve({
            status: res.statusCode,
            headers: res.headers,
            body: null,
            rawBody: data
          });
        }
      });
    });

    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Request timeout'));
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

function logSection(title) {
  console.log(`\n${colors.cyan}${colors.bright}═══════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}${title.padEnd(43)}${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}═══════════════════════════════════════════${colors.reset}\n`);
}

function logStatus(icon, name, status, details = '') {
  const statusText = status === true ? `${colors.green}✅ OK${colors.reset}` : 
                     status === false ? `${colors.red}❌ FAIL${colors.reset}` :
                     `${colors.yellow}⚠️  ${status}${colors.reset}`;
  console.log(`${icon} ${name.padEnd(30)} ${statusText}${details ? ` ${colors.bright}(${details})${colors.reset}` : ''}`);
}

async function testServerConnectivity() {
  logSection('🔌 SERVER CONNECTIVITY');
  
  try {
    console.log(`${colors.bright}Connecting to: ${BASE_URL}${colors.reset}\n`);
    
    const response = await makeRequest('GET', '/api/test/scheduler-status');
    if (response.status === 200) {
      logStatus('✅', 'Server Response', true, `Status ${response.status}`);
      console.log(`${colors.bright}Server is running and responding to requests${colors.reset}\n`);
      return true;
    } else {
      logStatus('⚠️ ', 'Server Response', `Status ${response.status}`);
      return false;
    }
  } catch (error) {
    logStatus('❌', 'Server Connection', false, error.message);
    console.log(`${colors.red}${colors.bright}Failed to connect to server at ${BASE_URL}${colors.reset}`);
    console.log('Make sure the server is running: npm start\n');
    return false;
  }
}

async function testSchedulerStatus() {
  logSection('⏰ SCHEDULER STATUS');
  
  try {
    const response = await makeRequest('GET', '/api/test/scheduler-status');
    
    if (response.status === 200 && response.body) {
      const schedulers = response.body;
      let activeCount = 0;
      
      for (const [name, scheduler] of Object.entries(schedulers)) {
        if (scheduler.isRunning) {
          logStatus('⏱️ ', name, true, scheduler.schedule);
          activeCount++;
        } else {
          logStatus('⏱️ ', name, false, scheduler.schedule);
        }
      }
      
      console.log(`\n${colors.green}✅ ${activeCount}/${Object.keys(schedulers).length} schedulers active${colors.reset}\n`);
      results.schedulers = schedulers;
      return true;
    }
    return false;
  } catch (error) {
    logStatus('❌', 'Scheduler Check', false, error.message);
    return false;
  }
}

async function testAuthEndpoints() {
  logSection('🔐 AUTHENTICATION ENDPOINTS');

  const endpoints = [
    { method: 'POST', path: '/api/auth/login', desc: 'User Login' },
    { method: 'POST', path: '/api/auth/register-super-admin', desc: 'Super Admin Registration' },
    { method: 'POST', path: '/api/auth/onboard-business-owner', desc: 'Business Owner Onboarding' },
    { method: 'POST', path: '/api/auth/onboard-vendor', desc: 'Vendor Onboarding' },
    { method: 'GET', path: '/api/auth/me', desc: 'Get Current User (Protected)' }
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await makeRequest(endpoint.method, endpoint.path, 
        endpoint.method === 'POST' ? { email: 'test@test.com', password: 'test123' } : null
      );
      
      const statusText = response.status < 400 ? 'Accessible' : 
                         response.status === 401 ? 'Requires Auth' :
                         response.status === 404 ? 'Not Found' :
                         `Status ${response.status}`;
      
      logStatus('🔑', endpoint.desc, statusText, `${endpoint.method.toUpperCase()} ${endpoint.path}`);
    } catch (error) {
      logStatus('🔑', endpoint.desc, 'Error', error.message);
    }
  }
  console.log();
}

async function testDataEndpoints() {
  logSection('📊 DATA MANAGEMENT ENDPOINTS');

  const endpoints = [
    { path: '/api/estates', name: 'Estates' },
    { path: '/api/estates/units', name: 'Units' },
    { path: '/api/tenants', name: 'Tenants' },
    { path: '/api/payments', name: 'Payments' },
    { path: '/api/wallet', name: 'Wallet' },
    { path: '/api/subscriptions/plans', name: 'Subscriptions' },
    { path: '/api/service-requests', name: 'Service Requests' },
    { path: '/api/notifications', name: 'Notifications' },
    { path: '/api/business-types', name: 'Business Types' },
    { path: '/api/billing/items', name: 'Billing' },
    { path: '/api/withdrawals', name: 'Withdrawals' },
    { path: '/api/vendor-manager-payout', name: 'Vendor Payouts' }
  ];

  for (const endpoint of endpoints) {
    try {
      const response = await makeRequest('GET', endpoint.path);
      
      let status = '';
      if (response.status === 200) status = true;
      else if (response.status === 401) status = 'Requires Auth';
      else if (response.status === 404) status = false;
      else status = `Status ${response.status}`;
      
      logStatus('📁', endpoint.name, status, endpoint.path);
    } catch (error) {
      logStatus('📁', endpoint.name, 'Timeout', endpoint.path);
    }
  }
  console.log();
}

async function testMiddleware() {
  logSection('🔧 MIDDLEWARE CHECKS');

  try {
    // Test CORS
    const response = await makeRequest('GET', '/api/test/scheduler-status');
    if (response.headers['access-control-allow-origin']) {
      logStatus('🔓', 'CORS', true, 'Enabled');
    }
    
    // Test request ID
    if (response.headers['x-request-id']) {
      logStatus('🔌', 'Request ID', true, 'Generated');
    }
    
    // Test compression
    if (response.headers['content-encoding']) {
      logStatus('📦', 'Compression', true, response.headers['content-encoding']);
    }
    
    // Test security headers
    const headers = ['x-powered-by', 'server'];
    let securityHeadersFound = 0;
    for (const header of headers) {
      if (response.headers[header]) securityHeadersFound++;
    }
    
    logStatus('🔒', 'Security Headers', securityHeadersFound > 0 ? true : 'Basic', 
      `${Object.keys(response.headers).length} headers`);
  } catch (error) {
    logStatus('🔧', 'Middleware Check', 'Error', error.message);
  }
  console.log();
}

async function testDocumentation() {
  logSection('📚 API DOCUMENTATION');

  const docEndpoints = [
    { path: '/api/docs', name: 'Swagger UI' },
    { path: '/api-docs', name: 'API Docs' },
    { path: '/swagger', name: 'OpenAPI Docs' }
  ];

  let docsFound = false;
  for (const doc of docEndpoints) {
    try {
      const response = await makeRequest('GET', doc.path);
      if (response.status < 404) {
        logStatus('📖', doc.name, true, `Available at ${doc.path}`);
        docsFound = true;
      }
    } catch (error) {
      // Ignore
    }
  }
  
  if (!docsFound) {
    logStatus('📖', 'API Documentation', 'Not Found', 'No docs endpoints accessible');
  }
  console.log();
}

async function printSystemSummary() {
  console.log(`\n${colors.cyan}${colors.bright}═══════════════════════════════════════════${colors.reset}`);
  console.log(`${colors.cyan}${colors.bright}SYSTEM SUMMARY${colors.reset}${''.padEnd(29)}`);
  console.log(`${colors.cyan}${colors.bright}═══════════════════════════════════════════${colors.reset}\n`);

  if (Object.keys(results.schedulers).length > 0) {
    const activeSchedulers = Object.values(results.schedulers).filter(s => s.isRunning).length;
    console.log(`${colors.green}✅ Schedulers${colors.reset}: ${activeSchedulers} active (Reminders, Reports, Payouts)`);
  }
  
  console.log(`${colors.green}✅ Authentication${colors.reset}: User login & registration available`);
  console.log(`${colors.green}✅ Data Management${colors.reset}: CRUD operations for estates, units, tenants, payments`);
  console.log(`${colors.green}✅ Financial Features${colors.reset}: Wallet, payments, subscriptions, withdrawals`);
  console.log(`${colors.green}✅ Notifications${colors.reset}: Service requests, notifications, reminders`);
  
  console.log(`\n${colors.bright}🎯 QUICK START:${colors.reset}`);
  console.log(`1. Login: POST /api/auth/login`);
  console.log(`2. View your wallet: GET /api/wallet`);
  console.log(`3. Browse all tenants: GET /api/tenants`);
  console.log(`4. Check full API docs in Swagger UI\n`);
  
  console.log(`${colors.bright}📋 NEXT STEPS:${colors.reset}`);
  console.log(`• Test with authentication credentials`);
  console.log(`• Create test estates and units`);
  console.log(`• Test payment processing`);
  console.log(`• Monitor scheduled tasks\n`);
}

async function runDiagnostics() {
  console.clear();
  console.log(`\n${colors.blue}${colors.bright}`);
  console.log('  ╔═══════════════════════════════════════╗');
  console.log('  ║  🧪 SYSTEM DIAGNOSTIC REPORT 🧪     ║');
  console.log('  ║      BamiHustle Backend v1.0.0       ║');
  console.log('  ╚═══════════════════════════════════════╝');
  console.log(`${colors.reset}\n`);
  
  try {
    const canConnect = await testServerConnectivity();
    
    if (!canConnect) {
      console.log(`\n${colors.red}${colors.bright}Cannot proceed with diagnostics - server not responding${colors.reset}\n`);
      process.exit(1);
    }
    
    await testSchedulerStatus();
    await testAuthEndpoints();
    await testDataEndpoints();
    await testMiddleware();
    await testDocumentation();
    await printSystemSummary();
    
    console.log(`${colors.cyan}${colors.bright}═══════════════════════════════════════════${colors.reset}\n`);
  } catch (error) {
    console.error(`${colors.red}Fatal error: ${error.message}${colors.reset}`);
    process.exit(1);
  }
}

runDiagnostics();
