/**
 * Centralized logging utility for development
 * Logs all errors with consistent formatting
 */

const logError = (endpoint, error, context = {}) => {
  const timestamp = new Date().toISOString();
  const errorDetails = {
    timestamp,
    endpoint,
    context,
    error: {
      message: error.message,
      code: error.code,
      name: error.name,
      path: error.path,
      value: error.value,
      kind: error.kind,
      status: error.status,
      statusCode: error.statusCode
    }
  };

  if (process.env.NODE_ENV === 'development') {
    console.error(`\n❌ [${timestamp}] ERROR ON ${endpoint}`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    
    if (Object.keys(context).length > 0) {
      console.error('📋 Context:', context);
    }
    
    console.error('📌 Error Type:', error.name || 'Unknown');
    console.error('💬 Message:', error.message);
    
    if (error.code) console.error('🔢 Code:', error.code);
    if (error.path) console.error('📍 Path:', error.path);
    if (error.kind) console.error('🏷️  Kind:', error.kind);
    if (error.value) console.error('📦 Value:', error.value);
    
    if (error.stack) {
      console.error('\n📚 Stack Trace:');
      console.error(error.stack);
    }
    
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  }

  return errorDetails;
};

const logInfo = (message, data = {}) => {
  if (process.env.NODE_ENV === 'development') {
    const timestamp = new Date().toISOString();
    console.log(`\n✅ [${timestamp}] ${message}`);
    if (Object.keys(data).length > 0) {
      console.log('📊 Data:', data);
    }
    console.log('');
  }
};

const logWarning = (message, data = {}) => {
  if (process.env.NODE_ENV === 'development') {
    const timestamp = new Date().toISOString();
    console.warn(`\n⚠️  [${timestamp}] WARNING: ${message}`);
    if (Object.keys(data).length > 0) {
      console.warn('📊 Data:', data);
    }
    console.warn('');
  }
};

module.exports = {
  logError,
  logInfo,
  logWarning
};
