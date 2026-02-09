require('dotenv').config();
const { sendOtpToSlack, sendTransactionToSlack, sendWithdrawalToSlack } = require('../utils/slackService');

console.log('🚀 Starting Slack Notification Verification Test...');

if (!process.env.SLACK_WEBHOOK_URL) {
    console.warn('⚠️  SLACK_WEBHOOK_URL is not set in .env. Test will simulate logic but no real message will be sent.');
}

// 1. Test OTP
console.log('\n--- Test 1: OTP ---');
try {
    sendOtpToSlack('test@example.com', '123456');
    console.log('✅ OTP logic triggered');
} catch (err) {
    console.error('❌ OTP test failed:', err.message);
}

// 2. Test Transaction
console.log('\n--- Test 2: Transaction ---');
try {
    const mockPayment = {
        amount: 50000,
        paymentType: 'rent',
        paymentMethod: 'card',
        paymentStatus: 'completed',
        reference: 'TEST-TX-123'
    };
    sendTransactionToSlack(mockPayment, 'Alice Tenant', 'Serene Estates');
    console.log('✅ Transaction logic triggered');
} catch (err) {
    console.error('❌ Transaction test failed:', err.message);
}

// 3. Test Withdrawal
console.log('\n--- Test 3: Withdrawal ---');
try {
    const mockWithdrawal = {
        amount: 25000,
        reference: 'TEST-WD-456',
        status: 'pending'
    };
    sendWithdrawalToSlack(mockWithdrawal, 'bob@manager.com', 'requested');
    console.log('✅ Withdrawal logic triggered');
} catch (err) {
    console.error('❌ Withdrawal test failed:', err.message);
}

// 4. Test Generic Activity
console.log('\n--- Test 4: Generic Activity ---');
try {
    sendActivityToSlack('Test Achievement Unlocked', {
        user: 'Antigravity AI',
        task: 'Slack Integration',
        status: 'Success'
    }, '#9C27B0', '⭐');
    console.log('✅ Generic Activity logic triggered');
} catch (err) {
    console.error('❌ Generic Activity test failed:', err.message);
}

console.log('\n🏁 Verification complete. Check your logger and (if configured) Slack channel.');
