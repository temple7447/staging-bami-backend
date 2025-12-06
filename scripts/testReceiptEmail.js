require('dotenv').config();
const { sendReceiptEmail } = require('../utils/emailService');

const testReceiptEmail = async () => {
    try {
        console.log('Preparing to send test receipt email...');

        // Mock Data
        const mockTenant = {
            tenantName: 'Vincent',
            tenantEmail: 'starukido@gmail.com', // Target email
            unitLabel: '3 BED ROOM',
            entryDate: new Date('2025-01-02'),
            nextDueDate: new Date('2025-12-31'),
            rentAmount: 420000,
            unit: {
                serviceChargeMonthly: 10000, // 120k annual
                cautionFee: 0
            }
        };

        const mockEstate = {
            name: 'BALADO ESTATE'
        };

        const mockPayment = {
            paymentDate: new Date('2025-02-01'),
            amount: 420000
        };

        const mockWallet = {
            balance: -270000 // Outstanding balance example
        };

        console.log(`Sending email to ${mockTenant.tenantEmail}...`);

        const result = await sendReceiptEmail(mockPayment, mockTenant, mockEstate, mockWallet);

        if (result.success) {
            console.log('✅ Email sent successfully!');
            console.log('Message ID:', result.messageId);
        } else {
            console.error('❌ Failed to send email');
        }

    } catch (error) {
        console.error('❌ Error:', error.message);
        console.error(error);
    }
};

testReceiptEmail();
