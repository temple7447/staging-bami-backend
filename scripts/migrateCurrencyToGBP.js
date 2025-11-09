const mongoose = require('mongoose');
const dotenv = require('dotenv');

dotenv.config();

const connectDatabase = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI || 'mongodb://localhost:27017/bamihustle', {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');
  } catch (err) {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  }
};

const migrateWalletCurrency = async () => {
  try {
    await connectDatabase();

    // Update all wallet documents with USD currency to GBP
    const result = await mongoose.connection.collection('wallets').updateMany(
      { currency: 'USD' },
      { $set: { currency: 'GBP' } }
    );

    console.log('\n═══════════════════════════════════════════════');
    console.log('✅ WALLET CURRENCY MIGRATION COMPLETED');
    console.log('═══════════════════════════════════════════════');
    console.log(`📝 Documents matched: ${result.matchedCount}`);
    console.log(`✏️  Documents modified: ${result.modifiedCount}`);
    console.log('💷 Currency updated from USD to GBP');
    console.log('═══════════════════════════════════════════════\n');

    process.exit(0);
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
};

migrateWalletCurrency();
