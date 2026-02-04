const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const {
    initiateRentPayment,
    recordManualPayment
} = require('../controllers/paymentController');
const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const User = require('../models/User');

async function testBundling() {
    try {
        const testId = Date.now();
        console.log(`🧪 Testing Bundling and Manual Recording (Run ${testId})...`);
        await mongoose.connect(process.env.MONGODB_URI);

        // 1. Setup Mock Data
        const estate = new Estate({
            name: `Test Estate ${testId}`,
            totalUnits: 10,
            createdBy: new mongoose.Types.ObjectId()
        });
        await estate.save();

        const user = await User.findOne({ role: 'admin' }) || new User({ name: 'Admin', email: `admin-${Date.now()}@test.com`, role: 'admin', password: 'password' });
        if (user.isNew) await user.save();

        const unit = new (require('../models/Unit'))({
            estate: estate._id,
            label: `UNIT-${testId}`,
            monthlyPrice: 100000,
            serviceChargeMonthly: 20000,
            createdBy: user._id
        });
        await unit.save();

        const tenantUser = new User({ name: 'Tenant User', email: `tenant-${Date.now()}@test.com`, role: 'tenant', password: 'password' });
        await tenantUser.save();

        const tenant = new Tenant({
            tenantName: 'Bundling Tester',
            estate: estate._id,
            user: tenantUser._id,
            unit: unit._id,
            unitLabel: 'TEST-B-1',
            rentAmount: 100000,
            serviceChargeAmount: 20000,
            entryDate: new Date(),
            nextDueDate: new Date(),
            createdBy: user._id
        });
        await tenant.save();

        console.log(`✅ Created test tenant: ${tenant.tenantName}`);
        console.log(`💰 Rent: ${tenant.rentAmount}, Service: ${tenant.serviceChargeAmount}`);

        // 2. Test Bundling in Initiation
        // We'll mock the req/res objects
        const mockReq = {
            body: {
                tenantId: tenant._id.toString(),
                durationMonths: 6
            },
            user: { id: user._id.toString(), role: 'admin', email: 'admin@test.com' }
        };

        const mockRes = {
            status: function (s) { this.statusCode = s; return this; },
            json: function (j) { this.jsonData = j; return this; }
        };

        console.log('\n🔄 Testing initiation bundling (6 months)...');
        await initiateRentPayment(mockReq, mockRes);

        const expectedTotal = (100000 * 6) + (20000 * 6);
        console.log(`📊 Expected Total: ${expectedTotal}`);
        console.log(`📊 Received Total: ${mockRes.jsonData.data.amount}`);

        if (mockRes.jsonData.data.amount === expectedTotal) {
            console.log('✅ Bundling logic works for initiation!');
        } else {
            console.error('❌ Bundling logic FAILED for initiation');
        }

        // 3. Test Manual Recording
        console.log('\n🔄 Testing manual recording (12 months)...');
        const manualReq = {
            body: {
                tenantId: tenant._id.toString(),
                paymentType: 'rent',
                amount: (100000 + 20000) * 12,
                paymentMethod: 'bank_transfer',
                durationMonths: 12,
                description: 'Annual payment bundle manual'
            },
            user: { id: user._id.toString() }
        };

        const initialDueDate = new Date(tenant.nextDueDate);
        await recordManualPayment(manualReq, mockRes);

        if (mockRes.statusCode === 201) {
            const updatedTenant = await Tenant.findById(tenant._id);
            const expectedDueDate = new Date(initialDueDate);
            expectedDueDate.setMonth(expectedDueDate.getMonth() + 12);

            console.log(`📅 Initial Due Date: ${initialDueDate.toISOString().split('T')[0]}`);
            console.log(`📅 Expected Due Date: ${expectedDueDate.toISOString().split('T')[0]}`);
            console.log(`📅 Updated Due Date: ${updatedTenant.nextDueDate.toISOString().split('T')[0]}`);

            if (updatedTenant.nextDueDate.toISOString().split('T')[0] === expectedDueDate.toISOString().split('T')[0]) {
                console.log('✅ Manual recording correctly shifted due date!');
            } else {
                console.error('❌ Manual recording due date shift FAILED');
            }
        } else {
            console.error('❌ Manual recording FAILED:', mockRes.jsonData.message);
        }

        // Cleanup
        await Tenant.deleteOne({ _id: tenant._id });
        await (require('../models/Unit')).deleteOne({ _id: unit._id });
        await User.deleteOne({ _id: tenantUser._id });
        await Estate.deleteOne({ _id: estate._id });
        console.log('\n🧹 Cleanup complete.');
        await mongoose.disconnect();
    } catch (err) {
        console.error('❌ Test failed:', err);
        await mongoose.disconnect();
    }
}

testBundling();
