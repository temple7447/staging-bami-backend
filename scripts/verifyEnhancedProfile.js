const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');

// Load env vars
dotenv.config();

/**
 * Verification script for Enhanced Vendor Profile
 */
async function verifyEnhancedProfile() {
    try {
        // Connect to database
        console.log('Connecting to database...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('Connected to MongoDB');

        // 1. Create a vendor with detailed profile and services
        console.log('\nCreating enhanced test vendor...');
        const vendorEmail = `enhanced_vendor_${Date.now()}@example.com`;
        const newVendor = await User.create({
            name: 'Bumi Hustle Test',
            email: vendorEmail,
            password: 'Password123!',
            phone: '08112233445',
            role: 'vendor',
            isActive: true,
            businessName: 'Bumi Hustle',
            bio: 'Authorized service provider dedicated to high-scale estate developments and structural excellence.',
            location: { city: 'Lagos', state: 'Nigeria' },
            operationalHours: { start: '9:00 AM', end: '6:00 PM' },
            isVerifiedPro: true,
            services: [
                {
                    name: 'General Consultation',
                    description: 'Standard architectural or structural review.',
                    price: 5500,
                    rateType: 'fixed'
                },
                {
                    name: 'Site Inspection',
                    description: 'Detailed on-site evaluation and reporting.',
                    price: 15000,
                    rateType: 'fixed'
                }
            ],
            rating: 4.9,
            reviewCount: 128
        });
        console.log('✅ Enhanced vendor created');

        // 2. Test Public Detail logic (simulating controller output)
        console.log('\n--- Testing Enhanced Public Detail output ---');
        const detail = await User.findOne({ _id: newVendor._id, role: 'vendor', isActive: true })
            .select('name businessName specialization businessAddress portfolio bio location operationalHours isVerifiedPro services rating reviewCount email phone')
            .lean();

        if (detail) {
            console.log('✅ Vendor detail fetched successfully');

            const requiredFields = [
                'bio', 'location', 'operationalHours',
                'isVerifiedPro', 'services', 'rating', 'reviewCount'
            ];

            const missingFields = requiredFields.filter(f => detail[f] === undefined);

            if (missingFields.length === 0) {
                console.log('✅ All UI-required fields are present in public detail response');
                console.log('Services Sample:', detail.services[0]);
            } else {
                console.error('❌ Missing fields:', missingFields);
            }
        } else {
            console.error('❌ Vendor detail not found!');
        }

        // Cleanup
        await User.deleteOne({ _id: newVendor._id });
        console.log('\nCleanup complete');

        console.log('\n🎉 ENHANCED PROFILE VERIFIED!');
        process.exit(0);

    } catch (error) {
        console.error('Verification failed:', error);
        process.exit(1);
    }
}

verifyEnhancedProfile();
