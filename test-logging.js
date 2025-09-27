#!/usr/bin/env node

/**
 * Test script to demonstrate enhanced Morgan logging
 * Run this while your server is running to see the logging in action
 */

const axios = require('axios');

const BASE_URL = 'http://localhost:5000';

async function testLogging() {
  console.log('🧪 Starting Morgan Logging Test...\n');
  
  try {
    // Test 1: Health check (should be skipped in logs)
    console.log('1. Testing health check (should be skipped in logs)...');
    await axios.get(`${BASE_URL}/health`);
    
    // Test 2: Get folder tree
    console.log('2. Testing GET /api/folders...');
    await axios.get(`${BASE_URL}/api/folders`);
    
    // Test 3: Get folders for materials
    console.log('3. Testing GET /api/folders/for-materials...');
    await axios.get(`${BASE_URL}/api/folders/for-materials`);
    
    // Test 4: Get folder statistics
    console.log('4. Testing GET /api/folders/stats...');
    await axios.get(`${BASE_URL}/api/folders/stats`);
    
    // Test 5: Try to create a folder (will fail without auth)
    console.log('5. Testing POST /api/folders (should fail with 401)...');
    try {
      await axios.post(`${BASE_URL}/api/folders`, {
        name: 'Test Folder',
        description: 'This is a test folder for logging demonstration'
      });
    } catch (error) {
      // Expected to fail with 401 - no auth
      console.log('   Expected auth error received');
    }
    
    // Test 6: Test materials endpoint
    console.log('6. Testing GET /api/materials...');
    await axios.get(`${BASE_URL}/api/materials`);
    
    // Test 7: Test auth endpoint
    console.log('7. Testing POST /api/auth/login (should fail with validation error)...');
    try {
      await axios.post(`${BASE_URL}/api/auth/login`, {
        email: 'test@example.com'
        // Missing password
      });
    } catch (error) {
      // Expected to fail with validation error
      console.log('   Expected validation error received');
    }
    
    console.log('\n✅ All tests completed! Check your server logs to see the enhanced Morgan logging in action.');
    console.log('\n📋 What to look for in your server logs:');
    console.log('   🎨 Color-coded endpoints: [FOLDER-API], [MATERIAL-API], [AUTH-API]');
    console.log('   📝 Detailed request information with emojis');
    console.log('   📤 Response summaries with status and data info');
    console.log('   ⏱️  Request/response timing');
    console.log('   👤 User information (when authenticated)');
    
  } catch (error) {
    if (error.code === 'ECONNREFUSED') {
      console.error('❌ Connection refused. Make sure your server is running on port 5000');
      console.log('\nTo start your server:');
      console.log('   npm run dev');
      console.log('   # or');
      console.log('   npm start');
    } else {
      console.error('❌ Test error:', error.message);
    }
  }
}

// Only run axios if it's available
const runTest = async () => {
  try {
    await testLogging();
  } catch (error) {
    if (error.code === 'MODULE_NOT_FOUND' && error.message.includes('axios')) {
      console.log('📦 Installing axios for testing...');
      const { exec } = require('child_process');
      exec('npm install axios', (error, stdout, stderr) => {
        if (error) {
          console.error('❌ Failed to install axios:', error);
          return;
        }
        console.log('✅ Axios installed. Running test...');
        delete require.cache[require.resolve('axios')];
        testLogging();
      });
    } else {
      console.error('❌ Test error:', error.message);
    }
  }
};

if (require.main === module) {
  runTest();
}

module.exports = { testLogging };