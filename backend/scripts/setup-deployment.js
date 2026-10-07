const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { hashPassword } = require('../src/services/passwords');

class DeploymentConfigurationError extends Error {}

function validateEnvironment(env) {
  if (env.NODE_ENV !== 'production') {
    throw new DeploymentConfigurationError('Deployment setup requires NODE_ENV=production');
  }
  let url;
  try { url = new URL(env.DATABASE_URL); } catch {
    throw new DeploymentConfigurationError('Set DATABASE_URL to the Neon direct connection string');
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || url.hostname.includes('-pooler.')) {
    throw new DeploymentConfigurationError('DATABASE_URL must use a direct PostgreSQL connection; LISTEN and migrations need a dedicated session');
  }
  const names = ['OTP_HMAC_SECRET', 'VISITOR_TOKEN_SECRET', 'ADMIN_TOKEN_SECRET', 'RATE_LIMIT_HMAC_SECRET'];
  const secrets = names.map(name => {
    if (!env[name] || env[name].length < 32 || env[name].startsWith('replace-me-')) {
      throw new DeploymentConfigurationError(`Set ${name} to an independent random secret of at least 32 characters`);
    }
    return env[name];
  });
  if (new Set(secrets).size !== secrets.length) {
    throw new DeploymentConfigurationError('Use a different value for each application secret');
  }
}

function validateInitialAdminCredentials(env) {
  if (!/^[a-z0-9._-]{3,255}$/.test(env.ADMIN_USERNAME || '') ||
      typeof env.ADMIN_PASSWORD !== 'string' || env.ADMIN_PASSWORD.length < 12 || env.ADMIN_PASSWORD.length > 128) {
    throw new DeploymentConfigurationError('Set ADMIN_USERNAME and a private ADMIN_PASSWORD of 12–128 characters for the initial hosted account');
  }
}

async function initializeDatabase(pool, env, seedDatabase) {
  const admins = await pool.query('SELECT EXISTS (SELECT 1 FROM admins) AS present');
  if (!admins.rows[0].present) validateInitialAdminCredentials(env);

  const events = await pool.query('SELECT EXISTS (SELECT 1 FROM events) AS present');
  if (!events.rows[0].present) await seedDatabase();

  if (!admins.rows[0].present) {
    const passwordHash = await hashPassword(env.ADMIN_PASSWORD);
    await pool.query(
      `INSERT INTO admins (username, password_hash, mfa_enabled)
       VALUES ($1, $2, FALSE) ON CONFLICT (username) DO NOTHING`,
      [env.ADMIN_USERNAME, passwordHash]
    );
    console.log('Initial hosted admin created. Its password is the private ADMIN_PASSWORD in Render Environment.');
  }
}

async function main() {
  validateEnvironment(process.env);
  try { require('../src/services/smsProvider').getSmsProvider(); } catch (error) {
    throw new DeploymentConfigurationError(error.message);
  }
  const { runner } = await import('node-pg-migrate');
  await runner({
    databaseUrl: process.env.DATABASE_URL,
    dir: path.resolve(__dirname, '../db/migrations'),
    migrationsTable: 'pgmigrations',
    direction: 'up',
    checkOrder: true,
    singleTransaction: true,
    log: () => {},
  });
  console.log('Database migrations are up to date.');
  const pool = require('../db/connection');
  try {
    await initializeDatabase(pool, process.env, async () => {
      const seed = spawnSync(process.execPath, [path.resolve(__dirname, '../db/seeds/initial-data.js')], {
        cwd: path.resolve(__dirname, '..'), env: process.env, stdio: 'inherit',
      });
      if (seed.error || seed.status !== 0) throw new Error('INITIAL_SEED_FAILED');
    });
    console.log('Deployment database is ready. Configure venue access and the voting schedule in the admin panel.');
  } finally {
    await pool.end();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error('Deployment setup failed:', error instanceof DeploymentConfigurationError
      ? error.message : (error.code || 'DATABASE_OR_SETUP_ERROR'));
    process.exitCode = 1;
  });
}

module.exports = { validateEnvironment, initializeDatabase };
