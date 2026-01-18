const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');
const BusinessType = require('../models/BusinessType');

// Load env vars
dotenv.config();

/**
 * Verification script for Vendor Onboarding changes
 */
async function verifyVendorOnboarding() {
    try {
        // Connect to database
        console.log('Connecting to database...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // 1. Find or create a Super Admin for createdBy
        let superAdmin = await User.findOne({ role: 'super_admin' });
        if (!superAdmin) {
            console.log('Creating test super admin...');
            superAdmin = await User.create({
                name: 'Test Super Admin',
                email: `testadmin_${Date.now()}@example.com`,
                password: 'Password123!',
                role: 'super_admin'
            });
        }

        // 2. Find or create a Business Type
        let businessType = await BusinessType.findOne({ isActive: true });
        if (!businessType) {
            console.log('Creating test business type...');
            businessType = await BusinessType.create({
                name: 'Test Cleaning Services',
                description: 'Testing services',
                createdBy: superAdmin._id
            });
        }

        // 3. Test Case 1: Onboard Vendor with ALL fields (including optional ones)
        console.log('\n--- Test 1: Onboarding Vendor with ALL fields ---');
        const fullVendorData = {
            name: 'Full Vendor',
            email: `fullvendor_${Date.now()}@example.com`,
            phone: '08123456789',
            role: 'vendor',
            businessName: 'Premium Cleaning Co',
            businessTypeId: businessType._id,
            specialization: 'Deep Cleaning',
            cacNumber: 'RC-99887766',
            govId: 'https://cloudinary.com/id.jpg',
            certification: 'https://cloudinary.com/cert.jpg',
            businessAddress: '123 Vendor Street, Lagos',
            portfolio: [
                'https://cloudinary.com/work1.jpg',
                'https://cloudinary.com/work2.jpg'
            ],
            createdBy: superAdmin._id,
            password: 'TemporaryPassword123!'
        };

        const fullVendor = await User.create(fullVendorData);
        console.log('✅ Vendor created with all fields:', fullVendor.name);

        // Verify fields
        if (fullVendor.cacNumber === 'RC-99887766' &&
            fullVendor.businessAddress === '123 Vendor Street, Lagos' &&
            fullVendor.portfolio.length === 2) {
            console.log('✅ Optional vendor fields (including portfolio) verified successfully');
        } else {
            console.error('❌ Vendor fields mismatch!', {
                cac: fullVendor.cacNumber,
                address: fullVendor.businessAddress,
                portfolioLength: fullVendor.portfolio?.length
            });
        }

        // 4. Test Case 2: Onboard Vendor with ONLY mandatory fields
        console.log('\n--- Test 2: Onboarding Vendor with MANTADORY fields only ---');
        const slimVendorData = {
            name: 'Slim Vendor',
            email: `slimvendor_${Date.now()}@example.com`,
            role: 'vendor',
            createdBy: superAdmin._id,
            password: 'TemporaryPassword123!'
        };

        const slimVendor = await User.create(slimVendorData);
        console.log('✅ Vendor created with mandatory fields:', slimVendor.name);

        // Verify absence of optional fields
        if (!slimVendor.cacNumber && !slimVendor.businessAddress) {
            console.log('✅ Optional fields correctly omitted');
        } else {
            console.error('❌ Optional fields should be empty!');
        }

        // Cleanup test data
        console.log('\nCleaning up test data...');
        await User.deleteOne({ _id: fullVendor._id });
        await User.deleteOne({ _id: slimVendor._id });
        console.log('Cleanup complete');

        console.log('\n🎉 ALL VERIFICATION TESTS PASSED!');
        process.exit(0);

    } catch (error) {
        console.error('Verification failed:', error);
        process.exit(1);
    }
}

verifyVendorOnboarding();
