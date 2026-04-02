const mongoose = require('mongoose');

const connectDatabase = async () => {
  try {
    const conn = await mongoose.connect(process.env.MONGODB_URI, {
      family: 4,
      serverSelectionTimeoutMS: 5000, // Faster timeout for connection failures
      // Connection pool configuration for better performance
      maxPoolSize: parseInt(process.env.MONGODB_MAX_POOL_SIZE) || 50, // Maximum connections
      minPoolSize: parseInt(process.env.MONGODB_MIN_POOL_SIZE) || 10, // Minimum connections
      maxIdleTimeMS: 30000, // Close idle connections after 30s
      socketTimeoutMS: 45000, // Socket timeout
      // Performance optimizations
      compressors: ['zlib'], // Enable compression
      zlibCompressionLevel: 6
    });

    console.log(`MongoDB Connected: ${conn.connection.host}`);
    console.log(`Connection pool: max=${conn.connection.client.s.options.maxPoolSize}, min=${conn.connection.client.s.options.minPoolSize}`);

    // Sync indexes to ensure schema changes are applied
    await mongoose.syncIndexes();
    console.log('✅ MongoDB indexes synced');

    // Monitor connection pool
    mongoose.connection.on('connectionPoolCreated', () => {
      console.log('✅ Connection pool created');
    });

    mongoose.connection.on('connectionPoolClosed', () => {
      console.log('⚠️  Connection pool closed');
    });

    // Handle connection events

    // Handle connection events
    mongoose.connection.on('error', (err) => {
      console.error('MongoDB connection error:', err);
    });

    mongoose.connection.on('disconnected', () => {
      console.warn('MongoDB disconnected');
    });

    // Handle process termination
    process.on('SIGINT', async () => {
      try {
        await mongoose.connection.close();
        console.log('MongoDB connection closed through app termination');
        process.exit(0);
      } catch (err) {
        console.error('Error during MongoDB connection close:', err);
        process.exit(1);
      }
    });

  } catch (error) {
    console.error('Database connection failed:', error.message);
    process.exit(1);
  }
};

module.exports = connectDatabase;