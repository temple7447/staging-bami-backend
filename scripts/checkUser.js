const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');
const User = require('../models/User');

// Load env vars
dotenv.config();

const checkUser = async () => {
    try {
        const email = process.argv[2] || 'bamihustle@gmail.com';
        const normalizedEmail = email.toLowerCase();

        console.log(`\n🔍 Searching for user: ${normalizedEmail}`);

        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        const user = await User.findOne({ email: normalizedEmail }).select('+password');

        if (user) {
            console.log('\n✅ USER FOUND!');
            console.log('-------------------');
            console.log(`ID: ${user._id}`);
            console.log(`Name: ${user.name}`);
            console.log(`Email: ${user.email}`);
            console.log(`Role: ${user.role}`);
            console.log(`Active: ${user.isActive}`);
            console.log(`Verified: ${user.emailVerified}`);
            console.log(`Created At: ${user.createdAt}`);
            console.log('-------------------');
        } else {
            console.log('\n❌ USER NOT FOUND');
            console.log(`The email "${normalizedEmail}" is not in the database.`);

            console.log('\nListing last 5 users for context:');
            const latestUsers = await User.find().sort({ createdAt: -1 }).limit(5);
            latestUsers.forEach(u => {
                console.log(`- ${u.email} (${u.role})`);
            });
        }

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('Error:', error.message);
        process.exit(1);
    }
};

checkUser();
