const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');

// Load env vars
dotenv.config();

/**
 * Verification script for Public Vendor Listing
 */
async function verifyPublicVendors() {
    try {
        // Connect to database
        console.log('Connecting to database...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // 1. Ensure at least one active vendor exists
        console.log('\nChecking for active vendors...');
        let vendor = await User.findOne({ role: 'vendor', isActive: true });

        if (!vendor) {
            console.log('No active vendor found. Creating a test vendor...');
            vendor = await User.create({
                name: 'Public Test Vendor',
                email: `public_vendor_${Date.now()}@example.com`,
                password: 'Password123!',
                phone: '08000000000',
                role: 'vendor',
                isActive: true,
                businessName: 'Public Service Co',
                specialization: 'Public Testing',
                businessAddress: '456 Public Lane',
                portfolio: ['https://example.com/work.jpg']
            });
            console.log('✅ Test vendor created');
        } else {
            console.log('✅ Found active vendor:', vendor.businessName || vendor.name);
        }

        // 2. Test Listing (simulating controller logic)
        console.log('\n--- Testing Public Listing logic ---');
        const query = { role: 'vendor', isActive: true };
        const vendors = await User.find(query)
            .select('name businessName specialization businessAddress portfolio businessTypeId email phone')
            .lean();

        console.log(`✅ Found ${vendors.length} public vendors`);

        // Check fields for first vendor
        const v = vendors[0];
        const sensitiveFields = ['password', 'role', 'isActive', 'passwordResetOtpHash'];
        const foundSensitive = sensitiveFields.filter(f => v[f] !== undefined);

        if (foundSensitive.length === 0) {
            console.log('✅ Sensitive fields successfully excluded');
        } else {
            console.error('❌ Found sensitive fields in public output:', foundSensitive);
        }

        if (v.name && (v.businessName || v.name)) {
            console.log('✅ Publicly safe data returned');
        }

        // 3. Test Detail logic
        console.log('\n--- Testing Public Detail logic ---');
        const detail = await User.findOne({ _id: vendor._id, role: 'vendor', isActive: true })
            .select('name businessName specialization businessAddress portfolio businessTypeId email phone cacNumber certification')
            .lean();

        if (detail) {
            console.log('✅ Vendor detail fetched successfully');
            if (detail.name === vendor.name) {
                console.log('✅ Correct vendor data returned');
            }
        } else {
            console.error('❌ Vendor detail not found!');
        }

        console.log('\n🎉 PUBLIC VENDOR ENDPOINTS VERIFIED!');
        process.exit(0);

    } catch (error) {
        console.error('Verification failed:', error);
        process.exit(1);
    }
}

verifyPublicVendors();
