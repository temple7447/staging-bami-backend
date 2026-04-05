const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');

dotenv.config();

const resetPassword = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        const user = await User.findOne({ role: 'super_admin' });
        if (!user) {
            console.log('❌ No super admin found');
            process.exit(1);
        }

        user.password = 'SuperAdmin123!';
        await user.save();
        console.log(`✅ Password reset for ${user.email}`);

        await mongoose.connection.close();
    } catch (error) {
        console.error('Error:', error.message);
    }
};

resetPassword();