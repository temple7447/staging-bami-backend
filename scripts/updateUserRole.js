const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');
const Tenant = require('../models/Tenant');

// Load env vars
dotenv.config();

const updateRoles = async () => {
    try {
        // Connect to database
        await mongoose.connect(process.env.MONGODB_URI, {
            useNewUrlParser: true,
            useUnifiedTopology: true,
        });

        console.log('Connected to MongoDB...');

        // 1. Update specific user
        const targetEmail = 'templevoke@gmail.com';
        const specificUser = await User.findOne({ email: targetEmail });

        if (specificUser) {
            specificUser.role = 'tenant';
            await specificUser.save({ validateBeforeSave: false });
            console.log(`✅ Updated ${targetEmail} to role: tenant`);
        } else {
            console.log(`❌ User with email ${targetEmail} not found.`);
        }

        // 2. Migration: Update all users linked to a Tenant document to have the 'tenant' role
        console.log('Starting general migration for all tenants...');
        const tenants = await Tenant.find({ user: { $exists: true, $ne: null }, isActive: true });

        let updatedCount = 0;
        for (const tenant of tenants) {
            const user = await User.findById(tenant.user);
            if (user && user.role === 'user') {
                user.role = 'tenant';
                await user.save({ validateBeforeSave: false });
                updatedCount++;
            }
        }

        console.log(`✅ General migration complete. Updated ${updatedCount} additional tenant(s) to the 'tenant' role.`);

    } catch (error) {
        console.error('❌ Error updating roles:', error.message);
        process.exit(1);
    } finally {
        // Close database connection
        await mongoose.connection.close();
        process.exit(0);
    }
};

// Handle unhandled promise rejections
process.on('unhandledRejection', (err) => {
    console.log(`Error: ${err.message}`);
    process.exit(1);
});

// Run script
updateRoles();
