require('dotenv').config();
const { sendEmail } = require('../utils/emailService');

async function testMailtrap() {
    console.log('\n🔍 Testing Mailtrap Configuration...\n');

    // Check environment variables
    console.log('Environment Variables:');
    console.log('MAILTRAP_TOKEN:', process.env.MAILTRAP_TOKEN ? '✅ SET (length: ' + process.env.MAILTRAP_TOKEN.length + ')' : '❌ MISSING');
    console.log('MAILTRAP_SENDER_EMAIL:', process.env.MAILTRAP_SENDER_EMAIL || '❌ MISSING');
    console.log('MAILTRAP_SENDER_NAME:', process.env.MAILTRAP_SENDER_NAME || '❌ MISSING');
    console.log('\n');

    if (!process.env.MAILTRAP_TOKEN) {
        console.error('❌ MAILTRAP_TOKEN is not set in .env file');
        console.log('\nTo fix this:');
        console.log('1. Go to https://mailtrap.io');
        console.log('2. Navigate to Settings → API Tokens');
        console.log('3. Copy your API token');
        console.log('4. Add to .env: MAILTRAP_TOKEN=your_token_here');
        process.exit(1);
    }

    // Try to send a test email
    try {
        console.log('📧 Attempting to send test email...\n');

        const result = await sendEmail({
            email: process.env.MAILTRAP_SENDER_EMAIL || 'test@example.com',
            subject: 'Mailtrap Test - BamiHustle',
            html: '<h2>Test Email</h2><p>If you receive this, Mailtrap is configured correctly!</p>'
        });

        console.log('✅ SUCCESS! Email sent successfully');
        console.log('Message ID:', result.messageId);
        console.log('\n🎉 Mailtrap is working correctly!\n');

    } catch (error) {
        console.error('❌ FAILED! Error sending email:');
        console.error('Error:', error.message);

        if (error.message.includes('Unauthorized')) {
            console.log('\n🔧 Fix for Unauthorized error:');
            console.log('1. Your MAILTRAP_TOKEN is invalid or expired');
            console.log('2. Go to https://mailtrap.io → Settings → API Tokens');
            console.log('3. Generate a new token or copy existing one');
            console.log('4. Update your .env file with the correct token');
        }

        process.exit(1);
    }
}

testMailtrap();
