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

test('deployment requires a direct database and independent secrets', () => {
  assert.doesNotThrow(() => validateEnvironment(environment()));
  for (const patch of [
    { NODE_ENV: 'development' }, { DATABASE_URL: '' },
    { DATABASE_URL: 'postgresql://user:password@ep-demo-pooler.example.test/neondb' },
    { VISITOR_TOKEN_SECRET: 'short' }, { ADMIN_TOKEN_SECRET: 'c'.repeat(32), OTP_HMAC_SECRET: 'c'.repeat(32) },
  ]) assert.throws(() => validateEnvironment({ ...environment(), ...patch }));
});

test('redeployment preserves existing data and ignores unused initial admin credentials', async () => {
  for (const patch of [
    {}, { ADMIN_PASSWORD: '123' }, { ADMIN_USERNAME: 'invalid username' },
    { ADMIN_USERNAME: undefined, ADMIN_PASSWORD: undefined },
  ]) {
    const env = { ...environment(), ...patch };
    assert.doesNotThrow(() => validateEnvironment(env));
    let reads = 0;
    const pool = { query: async (sql) => {
      assert.match(sql, /^SELECT EXISTS/);
      reads++;
      return { rows: [{ present: true }] };
    } };
    await initializeDatabase(pool, env, () => { throw new Error('Must not reseed existing event data'); });
    assert.equal(reads, 2);
  }
});

test('first deployment rejects invalid admin credentials before seeding or inserting', async () => {
  for (const patch of [
    { ADMIN_PASSWORD: '123' }, { ADMIN_PASSWORD: 'x'.repeat(129) },
    { ADMIN_USERNAME: 'a' }, { ADMIN_USERNAME: 'invalid username' },
    { ADMIN_USERNAME: undefined, ADMIN_PASSWORD: undefined },
  ]) {
    const pool = { query: async (sql) => {
      assert.equal(sql, 'SELECT EXISTS (SELECT 1 FROM admins) AS present');
      return { rows: [{ present: false }] };
    } };
    await assert.rejects(
      initializeDatabase(pool, { ...environment(), ...patch }, () => {
        assert.fail('Invalid initial credentials must not seed the database');
      }),
      /ADMIN_USERNAME.*ADMIN_PASSWORD/
    );
  }
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
