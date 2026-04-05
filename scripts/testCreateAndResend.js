require('dotenv').config();
const axios = require('axios');

const API_BASE = process.env.API_URL || 'http://localhost:5000/api';
const timestamp = Date.now();

async function login() {
    const response = await axios.post(`${API_BASE}/auth/login`, {
        email: 'ebamieyituoyo@gmail.com',
        password: 'SuperAdmin123!'
    });
    return response.data.token;
}

async function createTestUsers(token) {
    console.log('\n📝 Creating test users...\n');
    
    // Create business owner
    console.log('1️⃣ Creating Business Owner...');
    const businessOwner = await axios.post(`${API_BASE}/auth/onboard-business-owner`, {
        name: 'Test Business Owner',
        email: `bo.${timestamp}@test.com`,
        estateIds: []
    }, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.data)
    .catch(e => ({ error: e.response?.data || e.message }));
    console.log('   Result:', businessOwner.success ? `✅ Created: ${businessOwner.data?.email}` : `❌ ${businessOwner.error?.message || JSON.stringify(businessOwner.error)}`);

    // Create manager
    console.log('\n2️⃣ Creating Manager...');
    const manager = await axios.post(`${API_BASE}/auth/onboard-manager`, {
        name: 'Test Manager',
        email: `mgr.${timestamp}@test.com`,
        position: 'Property Manager'
    }, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.data)
    .catch(e => ({ error: e.response?.data || e.message }));
    console.log('   Result:', manager.success ? `✅ Created: ${manager.data?.email}` : `❌ ${manager.error?.message || JSON.stringify(manager.error)}`);

    // Get managers to find one for vendor
    const managers = await axios.get(`${API_BASE}/auth/managers`, { headers: { Authorization: `Bearer ${token}` } });
    const managerId = manager.data?._id || managers.data.data[0]?._id;

    // Create vendor
    console.log('\n3️⃣ Creating Vendor...');
    const vendor = await axios.post(`${API_BASE}/auth/onboard-vendor`, {
        name: 'Test Vendor',
        email: `vendor.${timestamp}@test.com`,
        businessType: 'Cleaning',
        serviceDescription: 'Cleaning services',
        managerId: managerId
    }, { headers: { Authorization: `Bearer ${token}` } })
    .then(r => r.data)
    .catch(e => ({ error: e.response?.data || e.message }));
    console.log('   Result:', vendor.success ? `✅ Created: ${vendor.data?.email}` : `❌ ${vendor.error?.message || JSON.stringify(vendor.error)}`);

    console.log('\n📋 Created user IDs:');
    console.log('   Business Owner:', businessOwner.data?.id || 'none');
    console.log('   Manager:', manager.data?.id || 'none');
    console.log('   Vendor:', vendor.data?.id || 'none');

    return { 
        businessOwner: businessOwner.data?.id,
        manager: manager.data?.id,
        vendor: vendor.data?.id
    };
}

async function resendCredentials(token, type, id) {
    const endpoints = {
        businessOwner: `business-owner/${id}/resend-credentials`,
        manager: `manager/${id}/resend-credentials`,
        vendor: `vendor/${id}/resend-credentials`
    };
    
    console.log(`   Calling: POST /api/auth/${endpoints[type]}`);
    try {
        const response = await axios.post(`${API_BASE}/auth/${endpoints[type]}`, {}, {
            headers: { Authorization: `Bearer ${token}` }
        });
        return response.data;
    } catch (e) {
        console.log(`   Error: ${e.response?.status} - ${e.response?.data?.message || e.message}`);
        throw e;
    }
}

async function main() {
    try {
        const token = await login();
        console.log('✅ Logged in');

        const users = await createTestUsers(token);
        
        await new Promise(r => setTimeout(r, 1000));

        console.log('\n🧪 Testing Resend Credentials...\n');

        if (users.businessOwner) {
            console.log('1️⃣ Business Owner...');
            const result = await resendCredentials(token, 'businessOwner', users.businessOwner);
            console.log('   Result:', result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
        } else {
            console.log('1️⃣ Business Owner: ❌ No ID');
        }
        
        if (users.manager) {
            console.log('2️⃣ Manager...');
            const result = await resendCredentials(token, 'manager', users.manager);
            console.log('   Result:', result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
        } else {
            console.log('2️⃣ Manager: ❌ No ID');
        }
        
        if (users.vendor) {
            console.log('3️⃣ Vendor...');
            const result = await resendCredentials(token, 'vendor', users.vendor);
            console.log('   Result:', result.success ? `✅ ${result.message}` : `❌ ${result.message}`);
        } else {
            console.log('3️⃣ Vendor: ❌ No ID');
        }

        console.log('\n🎉 Test completed!\n');
    } catch (error) {
        console.error('\n❌ Error:', error.response?.data?.message || error.message);
    }
}

main();