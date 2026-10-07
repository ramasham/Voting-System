require('dotenv').config();

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.DB_POOL_MAX) || 20,
  connectionTimeoutMillis: 5000,
  idleTimeoutMillis: 30000,
  statement_timeout: 15000,
  options: '-c timezone=UTC',
});

// A dropped idle connection must not crash every request on this API instance.
pool.on('error', (error) => {
  console.error('Idle database connection failed:', error.code || 'CONNECTION_ERROR');
});

module.exports = pool;
