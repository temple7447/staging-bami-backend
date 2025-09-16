const mongoose = require('mongoose');
const dotenv = require('dotenv');
const User = require('../models/User');

// Load env vars
dotenv.config();

const setupSuperAdmin = async () => {
  try {
    // Connect to database
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true,
    });

    console.log('Connected to MongoDB...');

    // Check if super admin already exists
    const existingSuperAdmin = await User.findOne({ role: 'super_admin' });
    
    if (existingSuperAdmin) {
      console.log('❌ Super admin already exists!');
      console.log(`Email: ${existingSuperAdmin.email}`);
      process.exit(1);
    }

    // Create super admin from environment variables
    const superAdmin = await User.create({
      name: process.env.SUPER_ADMIN_NAME || 'Super Administrator',
      email: process.env.SUPER_ADMIN_EMAIL || 'admin@bamihustle.com',
      password: process.env.SUPER_ADMIN_PASSWORD || 'SuperAdmin123!',
      role: 'super_admin',
      emailVerified: true
    });

    console.log('✅ Super admin created successfully!');
    console.log(`Name: ${superAdmin.name}`);
    console.log(`Email: ${superAdmin.email}`);
    console.log(`Role: ${superAdmin.role}`);
    console.log('\n🚀 You can now start the server and login with these credentials.');

  } catch (error) {
    console.error('❌ Error setting up super admin:', error.message);
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

// Run setup
setupSuperAdmin();