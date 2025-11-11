/**
 * Migration script to fix the Tenant collection index
 * Removes old index and applies new one with unitLabel
 */

require('dotenv').config();
const mongoose = require('mongoose');

async function fixTenantIndex() {
  try {
    console.log('🔌 Connecting to database...');
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/test');
    
    const db = mongoose.connection.db;
    const collection = db.collection('tenants');
    
    console.log('📋 Listing current indexes...');
    const indexes = await collection.listIndexes().toArray();
    console.log('Current indexes:', indexes.map(i => i.name));
    
    // Drop the old index if it exists
    const oldIndexName = 'estate_1_unitLabel_1_isActive_1';
    const hasOldIndex = indexes.some(i => i.name === oldIndexName);
    if (hasOldIndex) {
      console.log(`\n🗑️  Dropping old index: ${oldIndexName}`);
      await collection.dropIndex(oldIndexName);
      console.log('✅ Old index dropped');
    } else {
      console.log(`\n⏭️  Old index "${oldIndexName}" not found, skipping drop`);
    }
    
    // Also try the unit-based index
    const unitIndexName = 'unit_1_isActive_1';
    const hasUnitIndex = indexes.some(i => i.name === unitIndexName);
    if (hasUnitIndex) {
      console.log(`\n🗑️  Dropping old unit index: ${unitIndexName}`);
      await collection.dropIndex(unitIndexName);
      console.log('✅ Old unit index dropped');
    } else {
      console.log(`\n⏭️  Unit index "${unitIndexName}" not found, skipping drop`);
    }
    
    // Now load the model which will create the new index
    console.log('\n📚 Loading Tenant model to create new indexes...');
    require('../models/Tenant');
    
    // Trigger index creation with simpler partial filter
    await collection.createIndex(
      { estate: 1, unitLabel: 1, isActive: 1 },
      { 
        unique: true, 
        partialFilterExpression: { isActive: true }
      }
    );
    
    console.log('\n📋 New indexes after migration:');
    const newIndexes = await collection.listIndexes().toArray();
    console.log(newIndexes.map(i => i.name));
    
    console.log('\n✅ Migration completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Migration failed:', error.message);
    process.exit(1);
  }
}

fixTenantIndex();
