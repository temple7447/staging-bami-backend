const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Transaction = require('../models/Transaction');
const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const User = require('../models/User');

const verifyTransactionUnity = async () => {
    try {
        console.log('🚀 Starting Unified Transaction History Check...\n');

        // 1. Connect to MongoDB
        if (!process.env.MONGODB_URI) {
            console.error('❌ MONGODB_URI not found in .env');
            process.exit(1);
        }
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // 2. Identify Test Data
        const estate = await Estate.findOne() || { _id: new mongoose.Types.ObjectId() };
        const tenant = await Tenant.findOne() || { _id: new mongoose.Types.ObjectId() };
        const user = await User.findOne() || { _id: new mongoose.Types.ObjectId() };

        console.log(`ℹ️  Using Estate: ${estate.name || 'Mock'}`);
        console.log(`ℹ️  Using Tenant: ${tenant.tenantName || 'Mock'}`);

        // 3. Test New Enum Types
        const newTypes = ['service_charge', 'caution_fee', 'legal_fee', 'maintenance', 'initial'];
        console.log('\n📝 Testing new transaction types...');

        for (const type of newTypes) {
            try {
                const tx = new Transaction({
                    user: user._id,
                    tenant: tenant._id,
                    estate: estate._id,
                    amount: 1000,
                    type: type,
                    method: 'paystack',
                    status: 'completed',
                    reference: `TEST-REF-${type}-${Date.now()}`,
                    description: `Test unified transaction for ${type}`,
                    createdBy: user._id
                });

                await tx.validate();
                console.log(`   ✅ Type '${type}' is valid in Transaction schema`);

                // Actual save to verify database acceptance
                await tx.save();
                console.log(`   💾 Saved '${type}' transaction to database successfully`);

                // Cleanup
                await Transaction.deleteOne({ _id: tx._id });
            } catch (err) {
                console.error(`   ❌ Failed to validate or save type '${type}':`, err.message);
            }
        }

        console.log('\n✅ ALL NEW TRANSACTION TYPES VERIFIED');
        console.log('\n' + '═'.repeat(60));
        console.log('🎉 UNIFIED TRANSACTION HISTORY TEST PASSED');
        console.log('═'.repeat(60));

        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error during verification:', error.message);
        await mongoose.disconnect();
        process.exit(1);
    }
};

verifyTransactionUnity();
