const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const totp = require('../src/services/totp');
const pool = require('../db/connection');
const auth = require('../src/controllers/adminAuth.controller');
const { hashPassword } = require('../src/services/passwords');

function environment(t) {
  for (const name of ['MFA_ENCRYPTION_KEY', 'ADMIN_TOKEN_SECRET', 'RATE_LIMIT_HMAC_SECRET']) {
    const previous = process.env[name];
    process.env[name] = crypto.randomBytes(32).toString('hex');
    t.after(() => { if (previous === undefined) delete process.env[name]; else process.env[name] = previous; });
  }
}
function response() {
  return { statusCode: 200, status(n) { this.statusCode = n; return this; }, json(body) { this.body = body; return this; } };
}
function database(t, handler) {
  t.mock.method(pool, 'query', async (sql, values) => {
    if (sql.includes('INSERT INTO api_rate_limits')) return { rows: [{ hits: 1 }], rowCount: 1 };
    if (sql.startsWith('DELETE FROM api_rate_limits')) return { rows: [], rowCount: 0 };
    return handler(sql.replace(/\s+/g, ' ').trim(), values);
  });
}

test('TOTP matches the RFC 6238 SHA1 vectors, including dates beyond 2038', () => {
  const secret = totp.encodeSecret(Buffer.from('12345678901234567890'));
  for (const [seconds, expected] of [[59, '94287082'], [1111111109, '07081804'], [1111111111, '14050471'], [1234567890, '89005924'], [2000000000, '69279037'], [20000000000, '65353130']]) {
    assert.equal(totp.codeAt(secret, Math.floor(seconds / 30), 8), expected);
    assert.equal(totp.codeAt(secret, Math.floor(seconds / 30)), expected.slice(-6));
  }
});
test('TOTP permits one step of skew, rejects replay and malformed or distant codes', () => {
  const secret = totp.generateSecret();
  const now = 1500000000000, counter = Math.floor(now / 30000);
  assert.equal(totp.matchCounter(secret, totp.codeAt(secret, counter), -1, now), counter);
  assert.equal(totp.matchCounter(secret, totp.codeAt(secret, counter - 1), -1, now), counter - 1);
  assert.equal(totp.matchCounter(secret, totp.codeAt(secret, counter + 1), -1, now), counter + 1);
  assert.equal(totp.matchCounter(secret, totp.codeAt(secret, counter), counter, now), null);
  assert.equal(totp.matchCounter(secret, totp.codeAt(secret, counter - 3), -1, now), null);
  for (const invalid of [undefined, 123456, '12', 'abcdef', '１２３４５６']) assert.equal(totp.matchCounter(secret, invalid), null);
});
test('authenticator secrets are authenticated ciphertext and fail closed without their key', t => {
  environment(t);
  const secret = totp.generateSecret(), encrypted = totp.seal(secret);
  assert(!encrypted.includes(secret));
  assert.equal(totp.unseal(encrypted), secret);
  assert.notEqual(totp.seal(secret), encrypted);
  const parts = encrypted.split('.'); const bytes = Buffer.from(parts[2], 'base64url'); bytes[0] ^= 1; parts[2] = bytes.toString('base64url');
  assert.throws(() => totp.unseal(parts.join('.')));
  delete process.env.MFA_ENCRYPTION_KEY;
  assert.equal(totp.available(), false); assert.throws(() => totp.seal(secret));
});
test('correct password still cannot issue an admin token without required MFA', async t => {
  environment(t);
  const passwordHash = await hashPassword('MfaTestPassword2026!');
  database(t, sql => { assert.match(sql, /SELECT id, password_hash/); return { rows: [{ id: 1, password_hash: passwordHash, mfa_enabled: true, mfa_secret: totp.seal(totp.generateSecret()), mfa_last_counter: -1 }], rowCount: 1 }; });
  const res = response(); await auth.login({ body: { username: 'admin', password: 'MfaTestPassword2026!' }, ip: '127.0.0.1' }, res);
  assert.equal(res.statusCode, 401); assert.equal(res.body.code, 'MFA_REQUIRED'); assert.equal(res.body.accessToken, undefined);
});
test('MFA login atomically consumes a fresh code; concurrent replay cannot get a token', async t => {
  environment(t);
  const secret = totp.generateSecret(), sealed = totp.seal(secret), counter = Math.floor(Date.now() / 30000);
  const passwordHash = await hashPassword('MfaTestPassword2026!');
  let consumed = false;
  database(t, (sql, values) => {
    if (sql.startsWith('SELECT')) return { rows: [{ id: 1, password_hash: passwordHash, mfa_enabled: true, mfa_secret: sealed, mfa_last_counter: -1 }], rowCount: 1 };
    assert.match(sql, /mfa_last_counter < \$2 AND mfa_enabled = TRUE AND mfa_secret = \$3/);
    assert.deepEqual(values, [1, counter, sealed]);
    if (consumed) return { rows: [], rowCount: 0 }; consumed = true; return { rows: [{ id: 1 }], rowCount: 1 };
  });
  const request = { body: { username: 'admin', password: 'MfaTestPassword2026!', mfaCode: totp.codeAt(secret, counter) }, ip: '127.0.0.1' };
  const a = response(), b = response(); await Promise.all([auth.login(request, a), auth.login(request, b)]);
  assert.deepEqual([a.statusCode, b.statusCode].sort(), [200, 401]);
  assert.equal([a, b].filter(res => res.body.accessToken).length, 1);
});
test('MFA enrollment requires password reauthentication and stores only an encrypted pending secret', async t => {
  environment(t);
  const hash = await hashPassword('MfaTestPassword2026!');
  let stored;
  database(t, (sql, values) => {
    if (sql.startsWith('SELECT')) return { rows: [{ username: 'admin', password_hash: hash, mfa_enabled: false }], rowCount: 1 };
    assert.match(sql, /mfa_pending_until.*10 minutes/); stored = values[1]; return { rows: [{ id: 1 }], rowCount: 1 };
  });
  const wrong = response(); await auth.setupMfa({ auth: { id: 1 }, body: { password: 'WrongPassword2026!' } }, wrong);
  assert.equal(wrong.statusCode, 401); assert.equal(stored, undefined);
  const right = response(); await auth.setupMfa({ auth: { id: 1 }, body: { password: 'MfaTestPassword2026!' } }, right);
  assert.equal(right.statusCode, 200); assert.equal(totp.unseal(stored), right.body.data.secret);
  assert(right.body.data.otpauthUrl.startsWith('otpauth://totp/'));
});
test('MFA confirmation activates only the unexpired pending secret that was verified', async t => {
  environment(t);
  const secret = totp.generateSecret(), sealed = totp.seal(secret);
  const counter = Math.floor(Date.now() / 30000);
  database(t, (sql, values) => {
    if (sql.startsWith('SELECT')) { assert.match(sql, /mfa_pending_until > CURRENT_TIMESTAMP/); return { rows: [{ mfa_pending_secret: sealed }], rowCount: 1 }; }
    assert.match(sql, /mfa_pending_secret = \$2.*mfa_pending_until > CURRENT_TIMESTAMP/);
    assert.deepEqual(values, [1, sealed, counter]); return { rows: [{ id: 1 }], rowCount: 1 };
  });
  const res = response(); await auth.confirmMfa({ auth: { id: 1 }, body: { code: totp.codeAt(secret, counter) } }, res);
  assert.equal(res.statusCode, 200); assert.deepEqual(res.body.data, { mfa_enabled: true });
});
