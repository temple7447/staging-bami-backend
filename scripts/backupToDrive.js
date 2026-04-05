require('dotenv').config();
const mongoose = require('mongoose');
const { performBackup } = require('../utils/scheduler');

async function manualBackup() {
    try {
        console.log('🚀 Manual Backup Triggered');
        console.log('═'.repeat(40));

        if (!process.env.MONGODB_URI) {
            throw new Error('MONGODB_URI not found in .env');
        }

        console.log('🔄 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log(`✅ Connected: ${mongoose.connection.name}`);

        const result = await performBackup();

        if (result.success) {
            console.log('═'.repeat(40));
            console.log('✨ BACKUP PROCESS SUCCESSFUL');
            console.log(`📂 Folder: ${result.path}`);
            if (process.env.GOOGLE_REFRESH_TOKEN) {
              console.log('☁️  Status: Uploaded to Google Drive');
            } else {
              console.log('⚠️  Status: Local only (Google Drive not configured)');
            }
        } else {
            console.log('❌ BACKUP PROCESS FAILED');
            console.log(`Error: ${result.error}`);
        }

        await mongoose.connection.close();
        process.exit(result.success ? 0 : 1);
    } catch (error) {
        console.error('❌ Critical Error during manual backup:');
        console.error(error.message);
        process.exit(1);
    }
}

manualBackup();
