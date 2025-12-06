const axios = require('axios');

const BASE_URL = 'http://localhost:8080';

// Test data
const testSubscription = {
    name: 'Premium Hosting',
    price: 99,
    billingPeriod: 'month',
    description: 'Premium hosting plan with all features',
    icon: 'Layout (Frontend)',
    status: 'Active',
    features: 'Global CDN\nUnlimited Bandwidth\nDDoS Protection\n24/7 Support'
};

// You'll need to replace this with a valid token from your login
const AUTH_TOKEN = 'YOUR_AUTH_TOKEN_HERE';

async function testSubscriptionEndpoints() {
    console.log('🧪 Testing Subscription Endpoints\n');
    console.log('═'.repeat(60));

    let createdSubscriptionId = null;

    try {
        // Test 1: Create Subscription
        console.log('\n1️⃣  Testing: POST /api/subscriptions (Create Subscription)');
        const createResponse = await axios.post(
            `${BASE_URL}/api/subscriptions`,
            testSubscription,
            {
                headers: {
                    'Authorization': `Bearer ${AUTH_TOKEN}`,
                    'Content-Type': 'application/json'
                }
            }
        );
        console.log('✅ Create Subscription Success');
        console.log('Response:', JSON.stringify(createResponse.data, null, 2));
        createdSubscriptionId = createResponse.data.data._id;

        // Test 2: Get All Subscriptions
        console.log('\n2️⃣  Testing: GET /api/subscriptions (Get All Subscriptions)');
        const getAllResponse = await axios.get(`${BASE_URL}/api/subscriptions`);
        console.log('✅ Get All Subscriptions Success');
        console.log(`Found ${getAllResponse.data.data.length} subscriptions`);

        // Test 3: Get Subscription by ID
        if (createdSubscriptionId) {
            console.log('\n3️⃣  Testing: GET /api/subscriptions/:id (Get Subscription by ID)');
            const getByIdResponse = await axios.get(
                `${BASE_URL}/api/subscriptions/${createdSubscriptionId}`
            );
            console.log('✅ Get Subscription by ID Success');
            console.log('Response:', JSON.stringify(getByIdResponse.data, null, 2));
        }

        // Test 4: Update Subscription
        if (createdSubscriptionId) {
            console.log('\n4️⃣  Testing: PUT /api/subscriptions/:id (Update Subscription)');
            const updateResponse = await axios.put(
                `${BASE_URL}/api/subscriptions/${createdSubscriptionId}`,
                {
                    price: 149,
                    description: 'Updated premium hosting plan'
                },
                {
                    headers: {
                        'Authorization': `Bearer ${AUTH_TOKEN}`,
                        'Content-Type': 'application/json'
                    }
                }
            );
            console.log('✅ Update Subscription Success');
            console.log('Response:', JSON.stringify(updateResponse.data, null, 2));
        }

        // Test 5: Filter by Status
        console.log('\n5️⃣  Testing: GET /api/subscriptions?status=Active (Filter by Status)');
        const filterResponse = await axios.get(
            `${BASE_URL}/api/subscriptions?status=Active`
        );
        console.log('✅ Filter by Status Success');
        console.log(`Found ${filterResponse.data.data.length} active subscriptions`);

        // Test 6: Delete Subscription
        if (createdSubscriptionId) {
            console.log('\n6️⃣  Testing: DELETE /api/subscriptions/:id (Delete Subscription)');
            const deleteResponse = await axios.delete(
                `${BASE_URL}/api/subscriptions/${createdSubscriptionId}`,
                {
                    headers: {
                        'Authorization': `Bearer ${AUTH_TOKEN}`
                    }
                }
            );
            console.log('✅ Delete Subscription Success');
            console.log('Response:', JSON.stringify(deleteResponse.data, null, 2));
        }

        console.log('\n' + '═'.repeat(60));
        console.log('✅ All tests completed successfully!');
        console.log('═'.repeat(60) + '\n');

    } catch (error) {
        console.error('\n❌ Test Failed:');
        if (error.response) {
            console.error('Status:', error.response.status);
            console.error('Data:', JSON.stringify(error.response.data, null, 2));
        } else {
            console.error('Error:', error.message);
        }
        console.log('\n' + '═'.repeat(60) + '\n');
    }
}

// Run tests
testSubscriptionEndpoints();
