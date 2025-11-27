/**
 * Test script to send reminder emails
 * This script creates a test tenant scenario and sends reminder emails to both tenant and admin
 */

const mongoose = require('mongoose');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Tenant = require('../models/Tenant');
const Estate = require('../models/Estate');
const User = require('../models/User');
const { sendRentReminder, sendAdminRentReminder } = require('../utils/emailService');

const testReminderEmail = async () => {
    try {
        // Connect to MongoDB
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected to MongoDB');

        // Find or create a test estate
        let estate = await Estate.findOne().limit(1);
        if (!estate) {
            console.log('❌ No estate found in database. Please create an estate first.');
            process.exit(1);
        }
        console.log(`✅ Found estate: ${estate.name}`);

        // Find or create a test tenant
        let tenant = await Tenant.findOne({ estate: estate._id }).limit(1);
        if (!tenant) {
            console.log('❌ No tenant found. Creating a test tenant...');

            // Create a test tenant with due date 30 days from now
            const dueDate = new Date();
            dueDate.setDate(dueDate.getDate() + 30);

            tenant = await Tenant.create({
                tenantName: 'Test Tenant',
                tenantEmail: process.env.TEST_TENANT_EMAIL || 'test.tenant@example.com',
                tenantPhone: '+234 800 000 0000',
                estate: estate._id,
                unitLabel: 'Test Unit A1',
                rentAmount: 50000,
                nextDueDate: dueDate,
                status: 'occupied',
                isActive: true
            });
            console.log(`✅ Created test tenant: ${tenant.tenantName}`);
        } else {
            console.log(`✅ Found tenant: ${tenant.tenantName}`);
        }

        // Get admin users
        const admins = await User.find({ role: { $in: ['super_admin', 'admin'] }, isActive: true }).limit(1);
        if (admins.length === 0) {
            console.log('❌ No admin users found. Please create an admin first.');
            process.exit(1);
        }
        const admin = admins[0];
        console.log(`✅ Found admin: ${admin.email}`);

        // Calculate days remaining
        const today = new Date();
        const dueDate = new Date(tenant.nextDueDate);
        const diffTime = dueDate - today;
        const daysRemaining = Math.ceil(diffTime / (1000 * 60 * 60 * 24));

        console.log('\n' + '═'.repeat(60));
        console.log('📧 SENDING TEST REMINDER EMAILS');
        console.log('═'.repeat(60));
        console.log(`Tenant: ${tenant.tenantName} <${tenant.tenantEmail}>`);
        console.log(`Admin: ${admin.name} <${admin.email}>`);
        console.log(`Estate: ${estate.name}`);
        console.log(`Unit: ${tenant.unitLabel}`);
        console.log(`Rent Amount: ₦${tenant.rentAmount.toLocaleString()}`);
        console.log(`Due Date: ${dueDate.toLocaleDateString()}`);
        console.log(`Days ${daysRemaining >= 0 ? 'Remaining' : 'Overdue'}: ${Math.abs(daysRemaining)}`);
        console.log('═'.repeat(60));

        // Send tenant email
        console.log('\n📨 Sending email to TENANT...');
        try {
            await sendRentReminder(tenant, estate, daysRemaining);
            console.log(`✅ Tenant email sent successfully to ${tenant.tenantEmail}`);
        } catch (error) {
            console.error(`❌ Failed to send tenant email: ${error.message}`);
        }

        // Send admin email
        console.log('\n📨 Sending email to ADMIN...');
        try {
            await sendAdminRentReminder(admin.email, tenant, estate, daysRemaining);
            console.log(`✅ Admin email sent successfully to ${admin.email}`);
        } catch (error) {
            console.error(`❌ Failed to send admin email: ${error.message}`);
        }

        console.log('\n' + '═'.repeat(60));
        console.log('✅ TEST COMPLETED');
        console.log('═'.repeat(60));
        console.log('\n📬 Please check your email inbox:');
        console.log(`   • Tenant email: ${tenant.tenantEmail}`);
        console.log(`   • Admin email: ${admin.email}`);
        console.log('\n💡 If using Mailtrap, check your Mailtrap inbox.');
        console.log('═'.repeat(60));

        await mongoose.disconnect();
        process.exit(0);
    } catch (error) {
        console.error('\n❌ Error:', error.message);
        console.error(error);
        await mongoose.disconnect();
        process.exit(1);
    }
};

// Run the test
testReminderEmail();
