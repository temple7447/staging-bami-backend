const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { sendReceiptEmail } = require('../utils/emailService');
const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const User = require('../models/User');
const Wallet = require('../models/Wallet');

const sendLiveTestReceipt = async () => {
    try {
        console.log('🚀 Initiating Live Receipt Test to starukido@gmail.com...');

        // 1. Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // 2. Prepare Mock Data for a perfect SAMFRED Receipt
        const mockPayment = {
            _id: new mongoose.Types.ObjectId(),
            paymentDate: new Date(),
            paymentType: 'rent',
            amount: 420000,
            description: 'Annual Rent Payment'
        };

        const mockEstate = {
            name: 'SAMFRED GLOBAL RESOURCES LTD',
            address: 'BALADO ESTATE MASON IFIE OFF MATRIX DEPOT'
        };

        const mockTenant = {
            tenantName: 'Mabel Leleji (Test)',
            tenantEmail: 'starukido@gmail.com', // SENDING TO USER REQUESTED EMAIL
            unitLabel: 'FLAT 19',
            rentAmount: 420000,
            entryDate: new Date('2025-12-09'),
            nextDueDate: new Date('2026-12-09'),
            unit: {
                label: 'FLAT 19',
                serviceChargeMonthly: 12500, // 150,000 / 12
                cautionFee: 150000,
                legalFee: 100000
            }
        };

        const mockWallet = {
            balance: 0
        };

        console.log('📧 Target Email:', mockTenant.tenantEmail);
        console.log('📄 Style: SAMFRED Template (Redesigned)');

        // 3. Trigger Email
        await sendReceiptEmail(mockPayment, mockTenant, mockEstate, mockWallet);

        console.log('\n' + '═'.repeat(60));
        console.log('✅ TEST RECEIPT SENT SUCCESSFULLY!');
        console.log('═'.repeat(60));
        console.log('Recipient: starukido@gmail.com');
        console.log('Please check your Inbox (and Spam folder) in a few moments.');
        console.log('═'.repeat(60));

        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error sending test receipt:', error.message);
        if (error.message.includes('Missing Mailtrap env vars')) {
            console.error('💡 Hint: Check your .env for MAILTRAP_TOKEN and MAILTRAP_SENDER_EMAIL');
        }
        await mongoose.disconnect();
        process.exit(1);
    }
};

sendLiveTestReceipt();
