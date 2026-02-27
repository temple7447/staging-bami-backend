const requiredEnvVars = [
  'MONGODB_URI',
  'JWT_SECRET',
  'JWT_EXPIRE'
];

const optionalEnvVars = [
  { name: 'PORT', default: 4000 },
  { name: 'NODE_ENV', default: 'development' },
  { name: 'RATE_LIMIT_WINDOW_MS', default: 15 * 60 * 1000 },
  { name: 'RATE_LIMIT_MAX_REQUESTS', default: 200 },
  { name: 'LOG_LEVEL', default: 'info' }
];

const validateEnv = () => {
  const missing = [];
  const warnings = [];

  requiredEnvVars.forEach(envVar => {
    if (!process.env[envVar]) {
      missing.push(envVar);
    }
  });

  optionalEnvVars.forEach(({ name, default: defaultValue }) => {
    if (!process.env[name]) {
      warnings.push(`${name} not set, using default: ${defaultValue}`);
      process.env[name] = defaultValue;
    }
  });

  if (missing.length > 0) {
    console.error('\n❌ Missing required environment variables:');
    missing.forEach(envVar => console.error(`   - ${envVar}`));
    console.error('\nPlease add these to your .env file\n');
    process.exit(1);
  }

  if (warnings.length > 0 && process.env.NODE_ENV !== 'test') {
    console.warn('\n⚠️  Optional environment variables:');
    warnings.forEach(w => console.warn(`   - ${w}`));
    console.warn('');
  }

  if (process.env.NODE_ENV === 'production') {
    if (process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
      console.error('\n❌ JWT_SECRET must be at least 32 characters in production\n');
      process.exit(1);
    }

    if (process.env.NODE_ENV === 'production' && !process.env.ALLOWED_ORIGINS) {
      warnings.push('ALLOWED_ORIGINS not set - CORS will be restricted');
    }
  }

  return { valid: true, warnings };
};

module.exports = { validateEnv, requiredEnvVars };
