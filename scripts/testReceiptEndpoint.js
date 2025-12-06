require('dotenv').config();
const axios = require('axios');

const testReceiptEndpoint = async () => {
    try {
        console.log('Testing receipt endpoint...\n');

        const tenantId = '69314dfc44ec2cf1fecf42f3';
        const url = `http://localhost:8080/api/payments/tenant/${tenantId}/receipt`;

        console.log(`URL: ${url}`);
        console.log('Making request...\n');

        const startTime = Date.now();

        const response = await axios.post(url, {}, {
            headers: {
                'Content-Type': 'application/json',
                // Note: You'll need a valid token for this to work
                // 'Authorization': 'Bearer YOUR_VALID_TOKEN'
            },
            timeout: 15000
        });

        const endTime = Date.now();
        const duration = (endTime - startTime) / 1000;

        console.log('✅ Response received!');
        console.log(`⏱️  Response time: ${duration}s`);
        console.log('\nResponse data:');
        console.log(JSON.stringify(response.data, null, 2));

    } catch (error) {
        const endTime = Date.now();
        const duration = (Date.now() - startTime) / 1000;

        console.error('❌ Error occurred');
        console.error(`⏱️  Time before error: ${duration}s`);

        if (error.response) {
            console.error('\nResponse status:', error.response.status);
            console.error('Response data:', error.response.data);
        } else if (error.request) {
            console.error('\nNo response received');
            console.error('Error:', error.message);
        } else {
            console.error('\nError:', error.message);
        }
    }
};

let startTime = Date.now();
testReceiptEndpoint();
