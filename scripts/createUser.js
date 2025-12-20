const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');

// Load env vars
dotenv.config();

const createUser = async () => {
    try {
        const email = 'bamihustle@gmail.com';
        const password = 'Password123!';
        const name = 'BamiHustle Admin';
        const role = 'super_admin';

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // Check if user already exists
        const existingUser = await User.findOne({ email });
        if (existingUser) {
            console.log(`❌ User ${email} already exists!`);
            await mongoose.connection.close();
            process.exit(0);
        }

        const user = await User.create({
            name,
            email,
            password,
            role,
            emailVerified: true,
            isActive: true
        });

        console.log('\n✅ USER CREATED SUCCESSFULLY!');
        console.log('-------------------');
        console.log(`Email: ${user.email}`);
        console.log(`Password: ${password}`);
        console.log(`Role: ${user.role}`);
        console.log('-------------------');

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
};

createUser();
