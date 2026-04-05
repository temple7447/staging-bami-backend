require('dotenv').config();
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');

const backupDir = process.argv[2] || path.join(__dirname, '..', 'backups');

async function restoreDatabase() {
    try {
        if (!fs.existsSync(backupDir)) {
            console.error(`❌ Backup folder not found: ${backupDir}`);
            process.exit(1);
        }

        console.log('🔄 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log(`✅ Connected to: ${mongoose.connection.name}\n`);

        const files = fs.readdirSync(backupDir).filter(f => f.endsWith('.json'));
        
        if (files.length === 0) {
            console.log('❌ No backup files found');
            process.exit(1);
        }

        console.log(`📦 Found ${files.length} collection files\n`);

        for (const file of files) {
            const name = path.basename(file, '.json');
            console.log(`   📥 Restoring: ${name}...`);
            
            const data = JSON.parse(fs.readFileSync(path.join(backupDir, file), 'utf8'));
            
            if (data.length > 0) {
                const collection = mongoose.connection.db.collection(name);
                
                await collection.deleteMany({});
                await collection.insertMany(data);
                console.log(`   ✅ ${name}: ${data.length} documents restored`);
            } else {
                console.log(`   ⏭️  ${name}: empty, skipped`);
            }
        }

        console.log('\n✅ Restore complete!');

        await mongoose.connection.close();
        process.exit(0);
    } catch (error) {
        console.error('❌ Restore failed:', error.message);
        process.exit(1);
    }
}

restoreDatabase();