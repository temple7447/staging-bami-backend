require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
const dbName = mongoose.connection.name || 'test';
const backupDir = path.join(__dirname, '..', 'backups', `${dbName}_backup_${timestamp}`);

async function backupDatabase() {
    try {
        console.log('🔄 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log(`✅ Connected to: ${mongoose.connection.name}\n`);

        if (!fs.existsSync(backupDir)) {
            fs.mkdirSync(backupDir, { recursive: true });
        }

        const db = mongoose.connection.db;
        const collections = await db.listCollections().toArray();
        console.log(`📦 Found ${collections.length} collections\n`);

        for (const col of collections) {
            const name = col.name;
            console.log(`   📄 Backing up: ${name}...`);
            const collection = db.collection(name);
            const data = await collection.find({}).toArray();
            const filePath = path.join(backupDir, `${name}.json`);
            fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
            console.log(`   ✅ ${name}: ${data.length} documents`);
        }

        console.log(`\n✅ Backup complete!`);
        console.log(`📁 Saved to: ${backupDir}`);
        console.log(`📊 Database: ${dbName}`);

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Backup failed:', error.message);
        process.exit(1);
    }
}

backupDatabase();