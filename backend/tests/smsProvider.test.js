const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { getSmsProvider } = require('../src/services/smsProvider');
const { OTP_TTL_SECONDS } = require('../src/services/otp');

function setEnv(t, key, value) {
  const original = process.env[key];
  process.env[key] = value;
  t.after(() => {
    if (original === undefined) delete process.env[key];
    else process.env[key] = original;
  });
}

function configure(t) {
  for (const [key, value] of Object.entries({
    NODE_ENV: 'test',
    SMS_PROVIDER: 'smsgate',
    SMSGATE_MODE: 'local',
    SMSGATE_DEVICE_ID: '',
    SMSGATE_BASE_URL: 'http://192.168.1.50:8080',
    SMSGATE_USERNAME: 'test-gateway-user',
    SMSGATE_PASSWORD: 'test-gateway-password',
    SMSGATE_SIM_NUMBER: '',
  })) setEnv(t, key, value);
}

test('SMSGate requires credentials, a valid URL, a valid SIM slot, and HTTPS in production', (t) => {
  configure(t);
  process.env.SMSGATE_PASSWORD = '';
  assert.throws(getSmsProvider, /SMSGATE_USERNAME and SMSGATE_PASSWORD/);
  process.env.SMSGATE_PASSWORD = 'test-gateway-password';
  for (const url of ['', 'not-a-url', 'ftp://192.168.1.50', 'http://user:password@192.168.1.50', 'http://192.168.1.50?key=secret', 'http://192.168.1.50#fragment']) {
    process.env.SMSGATE_BASE_URL = url;
    assert.throws(getSmsProvider, /SMSGATE_BASE_URL/);
  }
  process.env.SMSGATE_BASE_URL = 'http://192.168.1.50:8080';
  process.env.SMSGATE_SIM_NUMBER = '4';
  assert.throws(getSmsProvider, /SMSGATE_SIM_NUMBER/);
  process.env.SMSGATE_SIM_NUMBER = '';
  process.env.NODE_ENV = 'production';
  assert.throws(getSmsProvider, /HTTPS in production/);
  process.env.SMSGATE_BASE_URL = 'https://gateway.example.test';
  assert.doesNotThrow(getSmsProvider);
});

test('SMSGate cloud uses the public API, cloud credentials, and an optional device', async (t) => {
  configure(t);
  process.env.SMSGATE_MODE = 'cloud';
  process.env.SMSGATE_BASE_URL = '';
  process.env.SMSGATE_DEVICE_ID = 'test-device-id';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.sms-gate.app/3rdparty/v1/messages');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from('test-gateway-user:test-gateway-password').toString('base64')}`);
    const payload = JSON.parse(options.body);
    assert.equal(payload.deviceId, 'test-device-id');
    assert.equal(payload.ttl, OTP_TTL_SECONDS);
    assert.deepEqual(payload.phoneNumbers, ['+962791234567']);
    return { ok: true, json: async () => ({ id: 'message-id', state: 'Pending' }) };
  });
  await getSmsProvider().sendOtp('+962791234567', '123456');
});

test('SMSGate cloud device check validates registration without claiming phone health', async (t) => {
  configure(t);
  process.env.SMSGATE_MODE = 'cloud';
  process.env.SMSGATE_BASE_URL = 'https://api.sms-gate.app/3rdparty/v1/';
  let devices = [{ id: 'one', name: 'private phone', lastSeen: '2000-01-01' }, { id: 'two' }];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.sms-gate.app/3rdparty/v1/devices');
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    return { ok: true, json: async () => devices };
  });
  assert.deepEqual(await getSmsProvider().checkConnection(), { status: 'registered', deviceCount: 2 });
  process.env.SMSGATE_DEVICE_ID = 'two';
  assert.deepEqual(await getSmsProvider().checkConnection(), { status: 'registered', deviceCount: 1 });
  process.env.SMSGATE_DEVICE_ID = 'missing';
  await assert.rejects(getSmsProvider().checkConnection(), /No matching Android device/);
  process.env.SMSGATE_DEVICE_ID = '';
  for (devices of [null, {}, [{ name: 'missing ID' }]]) {
    await assert.rejects(getSmsProvider().checkConnection(), /invalid device list/);
  }
});

test('SMSGate rejects unknown modes, insecure cloud URLs, and misplaced device IDs', (t) => {
  configure(t);
  process.env.SMSGATE_MODE = 'unknown';
  assert.throws(getSmsProvider, /SMSGATE_MODE/);
  process.env.SMSGATE_MODE = 'cloud';
  assert.throws(getSmsProvider, /HTTPS in cloud mode/);
  process.env.SMSGATE_MODE = 'local';
  process.env.SMSGATE_DEVICE_ID = 'device-id';
  assert.throws(getSmsProvider, /SMSGATE_DEVICE_ID/);
});

test('SMSGate submits the normalized recipient with a bounded OTP lifetime and selected SIM', async (t) => {
  configure(t);
  process.env.SMSGATE_SIM_NUMBER = '2';
  process.env.SMSGATE_BASE_URL += '/';
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'http://192.168.1.50:8080/message');
    assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from('test-gateway-user:test-gateway-password').toString('base64')}`);
    assert.equal(options.headers['Content-Type'], 'application/json');
    assert.equal(options.redirect, 'error');
    assert.ok(options.signal instanceof AbortSignal);
    assert.deepEqual(JSON.parse(options.body), {
      textMessage: { text: 'Your Maker Collective voting verification code is 123456. It expires in 60 seconds.' },
      phoneNumbers: ['+962791234567'],
      ttl: OTP_TTL_SECONDS,
      priority: 100,
      withDeliveryReport: true,
      simNumber: 2,
    });
    return { ok: true, json: async () => ({ id: 'gateway-message-id', state: 'Pending' }) };
  });
  await getSmsProvider().sendOtp('+962791234567', '123456');
});

test('SMSGate leaves SIM selection to Android when no slot is configured', async (t) => {
  configure(t);
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    assert.equal(Object.hasOwn(JSON.parse(options.body), 'simNumber'), false);
    return { ok: true, json: async () => ({ id: 'gateway-message-id', state: 'Sent' }) };
  });
  await getSmsProvider().sendOtp('+962791234567', '123456');
});

test('SMSGate rejects HTTP errors without reflecting private provider response data', async (t) => {
  configure(t);
  let canceled = false;
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false, status: 401,
    body: { cancel: async () => { canceled = true; } },
    json: async () => { throw new Error('Must not read a response containing recipients or credentials'); },
  }));
  await assert.rejects(getSmsProvider().sendOtp('+962791234567', '123456'), /^Error: SMSGate rejected the request \(HTTP 401\)$/);
  assert.equal(canceled, true);
});

test('SMSGate rejects failed, cancelled, malformed, and unknown acceptance responses', async (t) => {
  configure(t);
  let result;
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => result }));
  for (result of [null, {}, { id: '', state: 'Pending' }, { id: 'id', state: 'Failed', reason: '+962791234567' }, { id: 'id', state: 'Cancelled' }, { id: 'id', state: 'Cancelling' }, { id: 'id', state: 'unknown' }]) {
    await assert.rejects(getSmsProvider().sendOtp('+962791234567', '123456'), /^Error: SMSGate did not accept the verification message$/);
  }
  globalThis.fetch.mock.mockImplementation(async () => ({ ok: true, json: async () => { throw new SyntaxError('private response'); } }));
  await assert.rejects(getSmsProvider().sendOtp('+962791234567', '123456'), /^Error: SMSGate returned an invalid response$/);
});

test('SMSGate sanitizes connection and timeout errors', async (t) => {
  configure(t);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error('private recipient and credentials'); });
  await assert.rejects(getSmsProvider().sendOtp('+962791234567', '123456'), /^Error: Unable to reach the SMSGate API\./);
  globalThis.fetch.mock.mockImplementation(async () => { throw new DOMException('private timeout details', 'TimeoutError'); });
  await assert.rejects(getSmsProvider().checkConnection(), /^Error: Unable to reach the SMSGate API\./);
});

test('SMSGate connection check accepts warnings and rejects unhealthy or malformed health data', async (t) => {
  configure(t);
  let result = { status: 'warn', checks: { privateData: '+962791234567' } };
  t.mock.method(globalThis, 'fetch', async (_, options) => {
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    return { ok: true, json: async () => result };
  });
  assert.deepEqual(await getSmsProvider().checkConnection(), { status: 'warn' });
  for (result of [null, {}, { status: 'fail' }]) {
    await assert.rejects(getSmsProvider().checkConnection(), /unhealthy or invalid response/);
  }
});

test('sms:check authenticates against a local gateway without sending an SMS or printing secrets', async (t) => {
  const requests = [];
  const server = http.createServer((req, res) => {
    requests.push({ method: req.method, url: req.url, authorization: req.headers.authorization });
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'pass', privateData: 'test-gateway-password +962791234567 123456' }));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const { stdout, stderr } = await promisify(execFile)(process.execPath, [path.resolve(__dirname, '../scripts/check-sms.js')], {
    cwd: '/tmp',
    env: {
      ...process.env,
      NODE_ENV: 'test',
      SMS_PROVIDER: 'smsgate',
      SMSGATE_BASE_URL: `http://127.0.0.1:${server.address().port}`,
      SMSGATE_USERNAME: 'test-gateway-user',
      SMSGATE_PASSWORD: 'test-gateway-password',
      SMSGATE_SIM_NUMBER: '',
    },
    timeout: 15000,
  });
  assert.deepEqual(requests, [{
    method: 'GET', url: '/health',
    authorization: `Basic ${Buffer.from('test-gateway-user:test-gateway-password').toString('base64')}`,
  }]);
  assert.match(stdout, /phone reachable \(health: pass\).*No message was sent/);
  assert.doesNotMatch(stdout + stderr, /test-gateway-password|\+962791234567|123456/);
  assert.equal(stderr, '');
});
