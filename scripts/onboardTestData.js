const mongoose = require('mongoose');
require('dotenv').config();

const Estate = require('../models/Estate');
const Unit = require('../models/Unit');
const Tenant = require('../models/Tenant');
const User = require('../models/User');

const MONGO_URI = process.env.MONGODB_URI;

async function onboard() {
    try {
        await mongoose.connect(MONGO_URI);
        console.log('Connected to MongoDB');

        // 1. Find or Create Estate
        let estate = await Estate.findOne({ name: 'Bami Test Estate' });
        if (!estate) {
            estate = await Estate.create({
                name: 'Bami Test Estate',
                description: 'Test Environment for Contract Rules',
                totalUnits: 10,
                createdBy: new mongoose.Types.ObjectId() // Placeholder
            });
            console.log('Created Estate:', estate.name);
        }

        // 2. Create Units
        const adminId = estate.createdBy;

        const unit1 = await Unit.findOneAndUpdate(
            { estate: estate._id, label: 'Flat 101' },
            {
                monthlyPrice: 150000,
                serviceChargeMonthly: 20000,
                cautionFee: 50000,
                legalFee: 30000,
                status: 'vacant',
                isActive: true,
                createdBy: adminId,
                basePrice2024: 150000,
                lastRentIncreaseDate: new Date('2024-01-01'),
                baseServiceCharge2024: 20000,
                lastServiceIncreaseDate: new Date('2024-01-01'),
                baseCaution2024: 50000,
                lastCautionIncreaseDate: new Date('2024-01-01'),
                baseLegal2024: 30000,
                lastLegalIncreaseDate: new Date('2024-01-01')
            },
            { upsert: true, new: true }
        );

        const unit2 = await Unit.findOneAndUpdate(
            { estate: estate._id, label: 'Flat 102' },
            {
                monthlyPrice: 150000,
                serviceChargeMonthly: 20000,
                cautionFee: 50000,
                legalFee: 30000,
                status: 'vacant',
                isActive: true,
                createdBy: adminId,
                basePrice2024: 150000,
                lastRentIncreaseDate: new Date('2024-01-01'),
                baseServiceCharge2024: 20000,
                lastServiceIncreaseDate: new Date('2024-01-01'),
                baseCaution2024: 50000,
                lastCautionIncreaseDate: new Date('2024-01-01'),
                baseLegal2024: 30000,
                lastLegalIncreaseDate: new Date('2024-01-01')
            },
            { upsert: true, new: true }
        );

        console.log('Created/Updated Units: Flat 101, Flat 102');

        // 3. Create Users
        const pass = 'Password123!';

        let user1 = await User.findOne({ email: 'new_tenant@test.com' });
        if (!user1) {
            user1 = await User.create({
                name: 'New Tenant John',
                email: 'new_tenant@test.com',
                password: pass,
                role: 'tenant',
                emailVerified: true
            });
        } else {
            user1.password = pass;
            await user1.save();
        }

        let user2 = await User.findOne({ email: 'old_tenant@test.com' });
        if (!user2) {
            user2 = await User.create({
                name: 'Renewal Tenant Mary',
                email: 'old_tenant@test.com',
                password: pass,
                role: 'tenant',
                emailVerified: true
            });
        } else {
            user2.password = pass;
            await user2.save();
        }

        // 4. Create Tenants records

        // NEW TENANT (12 Months Rule)
        const nextDueNew = new Date();
        nextDueNew.setMonth(nextDueNew.getMonth() + 12);

        await Tenant.findOneAndUpdate(
            { tenantEmail: 'new_tenant@test.com' },
            {
                estate: estate._id,
                unit: unit1._id,
                unitLabel: unit1.label,
                tenantName: 'New Tenant John',
                tenantPhone: '08011112222',
                rentAmount: unit1.monthlyPrice,
                serviceChargeAmount: unit1.serviceChargeMonthly,
                tenantType: 'new',
                entryDate: new Date(),
                nextDueDate: nextDueNew,
                status: 'occupied',
                user: user1._id,
                isActive: true,
                baseRent2024: unit1.monthlyPrice,
                lastRentIncreaseDate: new Date(),
                baseServiceCharge2024: unit1.serviceChargeMonthly,
                lastServiceIncreaseDate: new Date(),
                baseCaution2024: unit1.cautionFee,
                lastCautionIncreaseDate: new Date(),
                baseLegal2024: unit1.legalFee,
                lastLegalIncreaseDate: new Date()
            },
            { upsert: true }
        );
        unit1.status = 'occupied';
        unit1.occupiedBy = user1._id; // Ideally tenant ID but user ID also works if model allows
        await unit1.save();

        // RENEWAL TENANT (Due in 1 month for visibility)
        const nextDueOld = new Date();
        nextDueOld.setMonth(nextDueOld.getMonth() + 1);

        await Tenant.findOneAndUpdate(
            { tenantEmail: 'old_tenant@test.com' },
            {
                estate: estate._id,
                unit: unit2._id,
                unitLabel: unit2.label,
                tenantName: 'Renewal Tenant Mary',
                tenantPhone: '08033334444',
                rentAmount: 250000,
                serviceChargeAmount: unit2.serviceChargeMonthly,
                tenantType: 'renewal',
                entryDate: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000), // In a year ago
                nextDueDate: nextDueOld,
                status: 'occupied',
                user: user2._id,
                isActive: true,
                baseRent2024: unit2.monthlyPrice,
                lastRentIncreaseDate: new Date('2024-01-01'),
                baseServiceCharge2024: unit2.serviceChargeMonthly,
                lastServiceIncreaseDate: new Date('2024-01-01'),
                baseCaution2024: unit2.cautionFee,
                lastCautionIncreaseDate: new Date('2024-01-01'),
                baseLegal2024: unit2.legalFee,
                lastLegalIncreaseDate: new Date('2024-01-01')
            },
            { upsert: true }
        );
        unit2.status = 'occupied';
        unit2.occupiedBy = user2._id;
        await unit2.save();

        console.log('Onboarding Complete!');
        console.log('-------------------');
        console.log('New Tenant Login: new_tenant@test.com / Password123!');
        console.log('Renewal Tenant Login: old_tenant@test.com / Password123!');

    } catch (err) {
        console.error('Onboarding Error:', err);
    } finally {
        await mongoose.disconnect();
    }
}

onboard();
