require('dotenv').config();
const https = require('https');

const webhookUrl = process.env.SLACK_WEBHOOK_URL;
console.log('Testing Webhook:', webhookUrl);

const data = JSON.stringify({
    text: 'Hello from BamiHustle! 🚀 This is a connectivity test.'
});

const url = new URL(webhookUrl);
const options = {
    hostname: url.hostname,
    path: url.pathname,
    method: 'POST',
    headers: {
        'Content-Type': 'application/json',
        'Content-Length': data.length
    }
};

const req = https.request(options, (res) => {
    console.log('Status Code:', res.statusCode);
    res.on('data', (d) => {
        process.stdout.write(d);
    });
});

req.on('error', (error) => {
    console.error('Error:', error);
});

req.write(data);
req.end();
