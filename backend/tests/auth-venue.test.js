const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// These tests use isolated credentials and a fake DB, never the developer's .env.
process.env.NODE_ENV = 'test';
process.env.OTP_HMAC_SECRET = 'test-otp-secret-'.repeat(4);
process.env.RATE_LIMIT_HMAC_SECRET = 'test-rate-secret-'.repeat(4);
process.env.VISITOR_TOKEN_SECRET = 'test-visitor-secret-'.repeat(4);
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-'.repeat(4);
const pool = { query: async () => { throw new Error('Unexpected DB query'); }, connect: async () => { throw new Error('Unexpected DB connection'); } };
const connectionPath = require.resolve('../db/connection');
require.cache[connectionPath] = { id: connectionPath, filename: connectionPath, loaded: true, exports: pool };

const { normalizePhoneNumber, normalizeAllowedIpRanges, parseOptionalDate, ipIsAllowed } = require('../src/utils/validation');
const { parseCoordinates, checkVenueAccess } = require('../src/services/locationVerification');
const { issueToken, verifyToken } = require('../src/services/tokens');
const { OTP_TTL_SECONDS, MAX_ATTEMPTS, hashOtp, otpMatches } = require('../src/services/otp');
const { hashPassword, verifyPassword } = require('../src/services/passwords');
const { getSmsProvider } = require('../src/services/smsProvider');
const { createRateLimiter } = require('../src/middleware/rateLimit.middleware');
const { verifyOtp, register } = require('../src/controllers/auth.controller');

function setEnv(t, key, value) {
  const original = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  });
}

function response() {
  return {
    statusCode: 200, body: null, headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    set(name, value) { this.headers[name] = value; return this; },
  };
}

function venue(settings, coordinates, clientIp = '203.0.113.8', client = pool) {
  return checkVenueAccess(client, { eventId: 1, settings, coordinates, clientIp });
}

test('Jordan mobile formats resolve to one identity; malformed trunk-prefix variants are rejected', () => {
  for (const phone of ['0791234567', '+962 79 123 4567', '00962-79-123-4567', '(079) 123-4567']) {
    assert.equal(normalizePhoneNumber(phone), '+962791234567');
  }
  for (const phone of ['+9620791234567', '079123', '791234567', '+9627912345678', 791234567, null]) {
    assert.equal(normalizePhoneNumber(phone), null);
  }
  assert.equal(normalizePhoneNumber('+44 7700 900123'), '+447700900123');
});

test('date validation rejects impossible calendar dates and missing timezones', () => {
  assert.throws(() => parseOptionalDate('2026-02-30T12:00:00Z'));
  assert.throws(() => parseOptionalDate('2026-10-07T12:00:00'));
  assert.equal(parseOptionalDate('2026-10-07T12:00:00+03:00'), '2026-10-07T09:00:00.000Z');
});

test('venue matching handles mapped IPv4, IPv6 and rejects malformed or global ranges', () => {
  assert.equal(ipIsAllowed('::ffff:192.0.2.4', '192.0.2.0/24'), true);
  assert.equal(ipIsAllowed('192.0.2.4', '::ffff:192.0.2.0/120'), true);
  assert.equal(ipIsAllowed('2001:db8::1', '2001:db8::/32'), true);
  assert.equal(ipIsAllowed('198.51.100.1', '192.0.2.0/24'), false);
  assert.throws(() => ipIsAllowed('192.0.2.4', '192.0.2.0/24,bad-range'));
  assert.throws(() => normalizeAllowedIpRanges('0.0.0.0/0'));
  assert.throws(() => ipIsAllowed('192.0.2.4', '::ffff:0:0/96'));
});

test('venue policy permits configured network before the admin records GPS and rejects unconfigured or outside requests', async () => {
  const settings = { allowed_ip_ranges: '192.0.2.0/24', location_enabled: true, location_ready: false };
  assert.equal((await venue(settings, null, '192.0.2.4')).allowed, true);
  assert.equal((await venue(settings)).code, 'OUTSIDE_VENUE');
  assert.equal((await venue({ location_enabled: true, location_ready: false })).code, 'VENUE_ACCESS_NOT_CONFIGURED');
  assert.equal((await venue({ allowed_ip_ranges: 'bad-range' })).code, 'VENUE_ACCESS_UNAVAILABLE');
});

test('GPS access requires a ready zone, valid coordinates and sufficient accuracy', async () => {
  const settings = { location_enabled: true, location_ready: true };
  const location = { latitude: 31.95, longitude: 35.91, accuracy: 15 };
  assert.equal(parseCoordinates({ latitude: 91, longitude: 0 }), null);
  assert.equal(parseCoordinates({ latitude: '31', longitude: 0 }), null);
  assert.equal((await venue(settings)).code, 'LOCATION_REQUIRED');
  assert.equal((await venue(settings, { ...location, accuracy: 101 })).code, 'LOCATION_INACCURATE');
  const client = { query: async (sql, values) => {
    assert.match(sql, /ST_Covers/);
    assert.deepEqual(values, [1, 35.91, 31.95]);
    return { rows: [{ inside: true }] };
  } };
  assert.equal((await venue(settings, location, null, client)).allowed, true);
  assert.equal((await venue(settings, location, null, { query: async () => ({ rows: [{ inside: false }] }) })).code, 'OUTSIDE_VENUE');
});

test('GPS during setup requires the admin to record the venue and cannot authorize access', async () => {
  const location = { latitude: 31.95, longitude: 35.91, accuracy: 15 };
  for (const allowed_ip_ranges of [null, '192.0.2.0/24']) {
    const settings = { allowed_ip_ranges, location_enabled: true, location_ready: false };
    const result = await venue(settings, location);
    assert.equal(result.allowed, false);
    assert.equal(result.code, 'LOCATION_NOT_READY');
    assert.equal(result.status, 503);
    assert.match(result.message, /admin must record the venue location/);
  }
  assert.equal((await venue({ allowed_ip_ranges: '192.0.2.0/24', location_enabled: true, location_ready: false }, location, '192.0.2.4')).method, 'network');
});

test('tokens enforce role separation, integrity and expiry', () => {
  const token = issueToken({ subject: 7, role: 'visitor', expiresInSeconds: 60 });
  assert.equal(verifyToken(token, 'visitor').id, 7);
  assert.throws(() => verifyToken(token, 'admin'));
  const [header, payload, signature] = token.split('.');
  const changedPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), sub: '8' })).toString('base64url');
  assert.throws(() => verifyToken(`${header}.${changedPayload}.${signature}`, 'visitor'));
  const expiredPayload = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(payload, 'base64url')), exp: 1 })).toString('base64url');
  const signed = crypto.createHmac('sha256', process.env.VISITOR_TOKEN_SECRET).update(`${header}.${expiredPayload}`).digest('base64url');
  assert.throws(() => verifyToken(`${header}.${expiredPayload}.${signed}`, 'visitor'));
  assert.throws(() => issueToken({ subject: 1, role: 'anything', expiresInSeconds: 60 }));
});

test('OTP digests are bound to the visitor and tolerate malformed hashes safely', () => {
  assert.equal(OTP_TTL_SECONDS, 60);
  assert.equal(MAX_ATTEMPTS, 3);
  const hash = hashOtp(1, '123456');
  assert.equal(otpMatches(1, '123456', hash), true);
  assert.equal(otpMatches(2, '123456', hash), false);
  assert.equal(otpMatches(1, '000000', hash), false);
  assert.equal(otpMatches(1, '123456', null), false);
});

test('passwords use salted hashes and reject malformed stored hashes', async () => {
  const first = await hashPassword('a-long-test-password');
  const second = await hashPassword('a-long-test-password');
  assert.notEqual(first, second);
  assert.equal(await verifyPassword('a-long-test-password', first), true);
  assert.equal(await verifyPassword('incorrect', first), false);
  assert.equal(await verifyPassword('a-long-test-password', `${first}a`), false);
});

test('production refuses console OTP and a missing SMS configuration', (t) => {
  setEnv(t, 'NODE_ENV', 'production');
  setEnv(t, 'SMS_PROVIDER', 'console');
  assert.throws(getSmsProvider, /cannot be used in production/);
  process.env.SMS_PROVIDER = 'twilio';
  setEnv(t, 'TWILIO_ACCOUNT_SID', '');
  assert.throws(getSmsProvider, /TWILIO_ACCOUNT_SID/);
});

test('Twilio provider submits real SMS using a bounded HTTPS request without reflecting provider errors', async (t) => {
  setEnv(t, 'SMS_PROVIDER', 'twilio');
  setEnv(t, 'TWILIO_ACCOUNT_SID', `AC${'1'.repeat(32)}`);
  setEnv(t, 'TWILIO_AUTH_TOKEN', 'fake-test-token');
  setEnv(t, 'TWILIO_FROM_NUMBER', '+15550000001');
  setEnv(t, 'TWILIO_MESSAGING_SERVICE_SID', '');
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /^https:\/\/api\.twilio\.com\/2010-04-01\/Accounts\/AC/);
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal);
    const body = new URLSearchParams(options.body);
    assert.equal(body.get('To'), '+962791234567');
    assert.equal(body.get('From'), '+15550000001');
    assert.match(body.get('Body'), /123456/);
    return { ok: true, json: async () => ({ sid: 'SM-test', status: 'queued' }) };
  });
  await getSmsProvider().sendOtp('+962791234567', '123456');
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: false, status: 429 }));
  await assert.rejects(getSmsProvider().sendOtp('+962791234567', '123456'), /^Error: SMS provider rejected the request \(HTTP 429\)$/);
});

test('HTTP and WebSocket use the same durable per-visitor vote quota without blocking other visitors on venue NAT', async (t) => {
  const counts = new Map();
  t.mock.method(pool, 'query', async (sql, values) => {
    if (sql.startsWith('DELETE')) return { rows: [] };
    const hits = (counts.get(values[0]) || 0) + 1;
    counts.set(values[0], hits);
    assert.doesNotMatch(values[0], /visitor:1/);
    return { rows: [{ hits }] };
  });
  const limiter = createRateLimiter({ name: 'test-vote', max: 2, windowMs: 60000 });
  const request = { auth: { role: 'visitor', id: 1 }, ip: '192.0.2.1' };
  let passed = 0;
  await limiter(request, response(), () => { passed += 1; });
  assert.equal((await limiter.consume('visitor:1')).allowed, true);
  const denied = response();
  await limiter(request, denied, () => { passed += 1; });
  assert.equal(denied.statusCode, 429);
  assert.equal(passed, 1);
  await limiter({ ...request, auth: { role: 'visitor', id: 2 } }, response(), () => { passed += 1; });
  assert.equal(passed, 2);
});

test('rate limit database failures fail closed', async (t) => {
  t.mock.method(console, 'error', () => {});
  t.mock.method(pool, 'query', async () => { throw new Error('DB unavailable'); });
  const limiter = createRateLimiter({ name: 'test-failure', max: 2, windowMs: 60000 });
  const res = response();
  await limiter({ auth: { role: 'visitor', id: 1 } }, res, () => assert.fail('must not continue'));
  assert.equal(res.statusCode, 503);
});

function otpFixture(t, overrides = {}) {
  const state = { id: 3, otp_hash: hashOtp(7, '123456'), expired: false, verified_at: null, attempts: 0, pending_name: 'Verified Owner', ...overrides };
  const writes = [];
  t.mock.method(pool, 'query', async () => ({ rows: [{ hits: 1 }] }));
  const client = { query: async (sql, values) => {
    if (sql.includes('SELECT id FROM visitors')) return { rowCount: 1, rows: [{ id: 7 }] };
    if (sql.includes('SELECT id, otp_hash')) return { rowCount: 1, rows: [{ ...state }] };
    if (sql.includes('SET attempts')) state.attempts += 1;
    if (sql.includes('SET verified_at')) state.verified_at = new Date();
    if (sql.includes('UPDATE visitors SET phone_verified')) writes.push(values);
    return { rowCount: 1, rows: [] };
  }, release() {} };
  t.mock.method(pool, 'connect', async () => client);
  return { state, writes };
}

test('OTP verification records the owned name and rejects code reuse', async (t) => {
  const { writes } = otpFixture(t);
  const req = { ip: '192.0.2.1', body: { phoneNumber: '0791234567', otp: '123456' } };
  const first = response();
  await verifyOtp(req, first);
  assert.equal(first.statusCode, 200);
  assert.equal(verifyToken(first.body.accessToken, 'visitor').id, 7);
  assert.deepEqual(writes, [[7, 'Verified Owner']]);
  const second = response();
  await verifyOtp(req, second);
  assert.equal(second.statusCode, 400);
  assert.equal(second.body.code, 'INVALID_OR_EXPIRED_OTP');
});

test('expired and exhausted OTPs never issue credentials', async (t) => {
  for (const [state, expectedStatus] of [[{ expired: true }, 400], [{ attempts: 5 }, 429]]) {
    const { writes } = otpFixture(t, state);
    const res = response();
    await verifyOtp({ ip: '192.0.2.1', body: { phoneNumber: '0791234567', otp: '123456' } }, res);
    assert.equal(res.statusCode, expectedStatus);
    assert.equal(res.body.accessToken, undefined);
    assert.equal(writes.length, 0);
  }
});

test('an incorrect OTP increments attempts without verifying the phone', async (t) => {
  const { state, writes } = otpFixture(t);
  const res = response();
  await verifyOtp({ ip: '192.0.2.1', body: { phoneNumber: '0791234567', otp: '000000' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(state.attempts, 1);
  assert.equal(writes.length, 0);
});

test('SMS failure expires the pending code and logs safe provider status without returning private details', async (t) => {
  setEnv(t, 'SMS_PROVIDER', 'smsgate');
  setEnv(t, 'SMSGATE_MODE', 'local');
  setEnv(t, 'SMSGATE_DEVICE_ID', '');
  setEnv(t, 'SMSGATE_BASE_URL', 'http://192.168.1.50:8080');
  setEnv(t, 'SMSGATE_USERNAME', 'test-user');
  setEnv(t, 'SMSGATE_PASSWORD', 'test-password');
  setEnv(t, 'SMSGATE_SIM_NUMBER', '');
  let providerStatus;
  const logs = [];
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false, status: providerStatus,
    json: async () => { throw new Error('Must not read private provider details'); },
  }));
  t.mock.method(console, 'error', (...args) => logs.push(args.join(' ')));
  let expired = false;
  t.mock.method(pool, 'query', async (sql) => {
    if (sql.includes('UPDATE otp_verifications')) expired = true;
    return { rows: [{ hits: 1 }] };
  });
  t.mock.method(pool, 'connect', async () => ({
    query: async (sql) => ({ rows: sql.includes('INSERT INTO visitors') ? [{ id: 7 }] : sql.includes('INSERT INTO otp_verifications') ? [{ id: 3 }] : [] }),
    release() {},
  }));
  for (providerStatus of [401, 403, 429, 503]) {
    expired = false;
    const res = response();
    await register({ ip: '192.0.2.1', body: { name: 'Owner', phoneNumber: '0791234567' } }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'SMS_UNAVAILABLE');
    assert.equal(expired, true);
    assert.equal(res.body.otp, undefined);
    assert.equal(res.body.accessToken, undefined);
    assert.ok(logs.includes(`SMS delivery failed: SMSGate rejected the request (HTTP ${providerStatus})`));
    assert.doesNotMatch(JSON.stringify(res.body), /HTTP|test-user|test-password|0791234567|962791234567/);
  }
  assert.doesNotMatch(logs.join('\n'), /test-user|test-password|0791234567|962791234567/);
});
