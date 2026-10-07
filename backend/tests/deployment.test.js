const test = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvironment, initializeDatabase } = require('../scripts/setup-deployment');
const { verifyPassword } = require('../src/services/passwords');

const environment = () => ({
  NODE_ENV: 'production', DATABASE_URL: 'postgresql://user:password@db.example.test/neondb?sslmode=require',
  OTP_HMAC_SECRET: 'a'.repeat(32), VISITOR_TOKEN_SECRET: 'b'.repeat(32),
  ADMIN_TOKEN_SECRET: 'c'.repeat(32), RATE_LIMIT_HMAC_SECRET: 'd'.repeat(32),
  ADMIN_USERNAME: 'makerspace', ADMIN_PASSWORD: 'private-deployment-test-password',
});

test('deployment requires a direct database, independent secrets, and initial admin credentials', () => {
  assert.doesNotThrow(() => validateEnvironment(environment()));
  for (const patch of [
    { NODE_ENV: 'development' }, { DATABASE_URL: '' },
    { DATABASE_URL: 'postgresql://user:password@ep-demo-pooler.example.test/neondb' },
    { VISITOR_TOKEN_SECRET: 'short' }, { ADMIN_TOKEN_SECRET: 'c'.repeat(32), OTP_HMAC_SECRET: 'c'.repeat(32) },
    { ADMIN_PASSWORD: '123' },
  ]) assert.throws(() => validateEnvironment({ ...environment(), ...patch }));
});

test('redeployment preserves existing event content and administrator credentials', async () => {
  let reads = 0;
  const pool = { query: async (sql) => {
    assert.match(sql, /^SELECT EXISTS/);
    reads++;
    return { rows: [{ present: true }] };
  } };
  await initializeDatabase(pool, environment(), () => { throw new Error('Must not reseed existing event data'); });
  assert.equal(reads, 2);
});

test('first deployment seeds an empty database and stores a salted password hash', async () => {
  let seeded = false;
  let inserted = false;
  const env = environment();
  const pool = { query: async (sql, values) => {
    if (sql.startsWith('SELECT EXISTS')) return { rows: [{ present: false }] };
    assert.ok(seeded);
    assert.match(sql, /INSERT INTO admins/);
    assert.equal(values[0], env.ADMIN_USERNAME);
    assert.notEqual(values[1], env.ADMIN_PASSWORD);
    assert.equal(await verifyPassword(env.ADMIN_PASSWORD, values[1]), true);
    inserted = true;
    return { rowCount: 1 };
  } };
  await initializeDatabase(pool, env, async () => { seeded = true; });
  assert.ok(inserted);
});
