const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
require('dotenv').config();

const User = require('../models/User');
const Estate = require('../models/Estate');

const MONGO_URI = process.env.MONGODB_URI;

async function getAdminToken() {
  const admin = await User.findOne({ role: 'super_admin' });
  if (!admin) {
    const altAdmin = await User.findOne({ role: 'admin' });
    if (!altAdmin) {
      throw new Error('No admin found. Please run setup first.');
    }
    return altAdmin.getSignedJwtToken();
  }
  return admin.getSignedJwtToken();
}

async function getEstateIds() {
  const estates = await Estate.find({ isActive: true }).limit(2).select('_id name');
  return estates.map(e => e._id.toString());
}

async function testOnboard() {
  try {
    await mongoose.connect(MONGO_URI);
    console.log('Connected to MongoDB');

    const token = await getAdminToken();
    const estateIds = await getEstateIds();
    
    console.log('Using admin token to onboard users...');
    console.log('Available estate IDs:', estateIds);

    const baseUrl = process.env.API_BASE_URL || 'http://localhost:5000/api';

    async function makeRequest(endpoint, data) {
      const response = await fetch(`${baseUrl}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(data)
      });
      const result = await response.json();
      console.log(`\n--- ${endpoint} ---`);
      console.log('Status:', response.status);
      console.log('Response:', JSON.stringify(result, null, 2));
      return { status: response.status, data: result };
    }

    console.log('\n========== TESTING VENDOR ONBOARDING ==========');
    
    const vendorResult = await makeRequest('/auth/onboard-vendor', {
      name: 'Test Vendor',
      email: `vendor_${Date.now()}@test.com`,
      phone: '+2348012345678',
      position: 'Service Provider',
      sendCredentials: false
    });

    console.log('\n========== TESTING MANAGER ONBOARDING ==========');
    
    const managerResult = await makeRequest('/auth/onboard-manager', {
      name: 'Test Manager',
      email: `manager_${Date.now()}@test.com`,
      phone: '+2348012345679',
      position: 'Property Manager',
      sendCredentials: false
    });

    console.log('\n========== SUMMARY ==========');
    console.log('Vendor onboarded:', vendorResult.status === 201 ? 'SUCCESS' : 'FAILED');
    console.log('Manager onboarded:', managerResult.status === 201 ? 'SUCCESS' : 'FAILED');

    if (vendorResult.status === 201) {
      console.log('\nVendor details:', {
        name: vendorResult.data.data.name,
        email: vendorResult.data.data.email,
        role: vendorResult.data.data.role
      });
    }

    if (managerResult.status === 201) {
      console.log('\nManager details:', {
        name: managerResult.data.data.name,
        email: managerResult.data.data.email,
        role: managerResult.data.data.role,
        position: managerResult.data.data.position,
        estates: managerResult.data.data.assignedEstates?.length || 0
      });
    }

  } catch (err) {
    console.error('Error:', err.message);
  } finally {
    await mongoose.disconnect();
    console.log('\nDisconnected from MongoDB');
  }
}

testOnboard();
