require('dotenv').config();
const axios = require('axios');

const API_BASE = process.env.API_URL || 'http://localhost:5000/api';

async function login() {
    const response = await axios.post(`${API_BASE}/auth/login`, {
        email: process.env.SUPER_ADMIN_EMAIL || 'admin@bami.com',
        password: process.env.SUPER_ADMIN_PASSWORD || 'Admin123!'
    });
    return response.data.token;
}

async function getBusinessOwners(token) {
    const response = await axios.get(`${API_BASE}/auth/business-owners`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return response.data.data;
}

async function getVendors(token) {
    const response = await axios.get(`${API_BASE}/auth/vendors`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return response.data.data;
}

async function getManagers(token) {
    const response = await axios.get(`${API_BASE}/auth/managers`, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return response.data.data;
}

async function resendBusinessOwnerCredentials(token, id) {
    const response = await axios.post(`${API_BASE}/auth/business-owner/${id}/resend-credentials`, {}, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
}

async function resendVendorCredentials(token, id) {
    const response = await axios.post(`${API_BASE}/auth/vendor/${id}/resend-credentials`, {}, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
}

async function resendManagerCredentials(token, id) {
    const response = await axios.post(`${API_BASE}/auth/manager/${id}/resend-credentials`, {}, {
        headers: { Authorization: `Bearer ${token}` }
    });
    return response.data;
}

async function testResendCredentials() {
    console.log('\n🧪 Testing Resend Credentials Endpoints...\n');

    try {
        console.log('1️⃣  Logging in as super admin...');
const response = await axios.post(`${API_BASE}/auth/login`, {
            email: 'ebamieyituoyo@gmail.com',
            password: 'SuperAdmin123!'
        });
        console.log('Response data:', response.data);
        const token = response.data.token;
        console.log('   ✅ Logged in successfully\n');

        // Test resend for business owner
        console.log('2️⃣  Testing Business Owner Resend Credentials...');
        const businessOwners = await getBusinessOwners(token);
        if (businessOwners.length > 0) {
            const result1 = await resendBusinessOwnerCredentials(token, businessOwners[0]._id);
            console.log(`   ✅ Business Owner: ${result1.message}`);
        } else {
            console.log('   ⚠️  No business owners found, skipping');
        }
        console.log();

        // Test resend for vendor
        console.log('3️⃣  Testing Vendor Resend Credentials...');
        const vendors = await getVendors(token);
        if (vendors.length > 0) {
            const result2 = await resendVendorCredentials(token, vendors[0]._id);
            console.log(`   ✅ Vendor: ${result2.message}`);
        } else {
            console.log('   ⚠️  No vendors found, skipping');
        }
        console.log();

        // Test resend for manager
        console.log('4️⃣  Testing Manager Resend Credentials...');
        const managers = await getManagers(token);
        if (managers.length > 0) {
            const result3 = await resendManagerCredentials(token, managers[0]._id);
            console.log(`   ✅ Manager: ${result3.message}`);
        } else {
            console.log('   ⚠️  No managers found, skipping');
        }
        console.log();

        console.log('🎉 All resend credentials tests passed!\n');

    } catch (error) {
        console.error('❌ Test failed:');
        console.error('   Status:', error.response?.status);
        console.error('   Message:', error.response?.data?.message || error.message);
        process.exit(1);
    }
}

testResendCredentials();