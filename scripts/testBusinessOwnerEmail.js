require('dotenv').config();
const { sendBusinessOwnerWelcomeEmail } = require('../utils/emailService');

async function testBusinessOwnerEmail() {
    console.log('\n🧪 Testing Business Owner Welcome Email...\n');

    // Check environment
    console.log('Environment Check:');
    console.log('MAILTRAP_TOKEN:', process.env.MAILTRAP_TOKEN ? '✅ SET' : '❌ MISSING');
    console.log('MAILTRAP_SENDER_EMAIL:', process.env.MAILTRAP_SENDER_EMAIL || '❌ MISSING');
    console.log('\n');

    // Mock user object
    const mockUser = {
        name: 'Test Business Owner',
        email: 'test@example.com',
        phone: '+2348012345678'
    };

    // Mock estates
    const mockEstates = [
        { name: 'Test Estate 1', totalUnits: 50 },
        { name: 'Test Estate 2', totalUnits: 30 }
    ];

    const mockPassword = 'TestPassword123!';

    try {
        console.log('📧 Sending business owner welcome email...\n');
        console.log('To:', mockUser.email);
        console.log('Estates:', mockEstates.length);
        console.log('\n');

        const result = await sendBusinessOwnerWelcomeEmail(mockUser, mockPassword, mockEstates);

        console.log('✅ SUCCESS! Email sent successfully');
        console.log('Result:', result);
        console.log('\n🎉 Business owner welcome email is working!\n');

    } catch (error) {
        console.error('❌ FAILED! Error sending email:');
        console.error('Error message:', error.message);
        console.error('Full error:', error);

        if (error.message.includes('Unauthorized')) {
            console.log('\n💡 This is the same error you\'re seeing in the API!');
            console.log('The issue is NOT with your server restart.');
            console.log('Check if the Mailtrap client is being initialized correctly.');
        }

        process.exit(1);
    }
}

testBusinessOwnerEmail();
