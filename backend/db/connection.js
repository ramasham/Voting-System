require('dotenv').config();

const { Pool } = require('pg');

function positiveIntegerSetting(name, fallback, maximum) {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 && value <= maximum ? value : fallback;
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: positiveIntegerSetting('DB_POOL_MAX', 20, 200),
  connectionTimeoutMillis: positiveIntegerSetting('DB_CONNECTION_TIMEOUT_MS', 5000, 60000),
  idleTimeoutMillis: 30000,
  statement_timeout: 15000,
  options: '-c timezone=UTC',
});

// A dropped idle connection must not crash every request on this API instance.
pool.on('error', (error) => {
  console.error('Idle database connection failed:', error.code || 'CONNECTION_ERROR');
});

module.exports = pool;
