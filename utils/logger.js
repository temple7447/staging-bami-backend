/**
 * Centralized logging utility for development
 * Logs all errors with consistent formatting
 */

const logError = (endpoint, error, context = {}) => {
  const timestamp = new Date().toISOString();
  const safeError = error || {};
  const errorDetails = {
    timestamp,
    endpoint,
    context,
    error: {
      message: safeError.message || 'No message provided',
      code: safeError.code,
      name: safeError.name,
      path: safeError.path,
      value: safeError.value,
      kind: safeError.kind,
      status: safeError.status,
      statusCode: safeError.statusCode
    }
  };

  if (process.env.NODE_ENV === 'development') {
    console.error(`\n❌ [${timestamp}] ERROR ON ${endpoint}`);
    console.error('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

    if (Object.keys(context).length > 0) {
      console.error('📋 Context:', context);
    }

    console.error('📌 Error Type:', safeError.name || 'Unknown');
    console.error('💬 Message:', safeError.message || 'No message provided');

    if (safeError.code) console.error('🔢 Code:', safeError.code);
    if (safeError.path) console.error('📍 Path:', safeError.path);
    if (safeError.kind) console.error('🏷️  Kind:', safeError.kind);
    if (safeError.value) console.error('📦 Value:', safeError.value);

    if (safeError.stack) {
      console.error('\n📚 Stack Trace:');
      console.error(safeError.stack);
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
