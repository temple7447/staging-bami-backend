require('dotenv').config();
const mongoose = require('mongoose');

async function checkConnection() {
    try {
        console.log('🔄 Connecting to MongoDB...');
        await mongoose.connect(process.env.MONGODB_URI);
        console.log('✅ Connected\n');
        
        console.log('DB Name:', mongoose.connection.name);
        console.log('DB State:', mongoose.connection.readyState);
        
        const collections = await mongoose.connection.db.listCollections().toArray();
        console.log('\nCollections:', collections.length);
        collections.forEach(c => console.log(' -', c.name));
        
        await mongoose.connection.close();
    } catch (error) {
        console.error('Error:', error.message);
    }
}

checkConnection();