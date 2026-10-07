const test = require('node:test');
const assert = require('node:assert/strict');
const { checkSmsOnStartup } = require('../src/services/smsDiagnostics');
const { getSmsProvider, describeSmsFailure } = require('../src/services/smsProvider');

function configure(t) {
  for (const [key, value] of Object.entries({
    NODE_ENV: 'production', SMS_PROVIDER: 'smsgate', SMSGATE_MODE: 'cloud',
    SMSGATE_BASE_URL: 'https://api.sms-gate.app/3rdparty/v1',
    SMSGATE_USERNAME: 'private-test-user', SMSGATE_PASSWORD: 'private-test-password',
    SMSGATE_DEVICE_ID: '', SMSGATE_SIM_NUMBER: '',
  })) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }
  const logs = [];
  t.mock.method(console, 'info', line => logs.push(line));
  t.mock.method(console, 'error', line => logs.push(line));
  return logs;
}

test('startup check authenticates using only GET and omits private device information', async t => {
  const logs = configure(t);
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.equal(url, 'https://api.sms-gate.app/3rdparty/v1/devices');
    assert.equal(options.method, 'GET');
    assert.equal(options.body, undefined);
    return { ok: true, json: async () => [{ id: 'private-device-id', name: 'private-device-name', phoneNumber: '+962791234567' }] };
  });
  await checkSmsOnStartup();
  assert.equal(logs.length, 1);
  assert.match(logs[0], /authentication succeeded; 1 registered device/);
  assert.match(logs[0], /No SMS was sent.*does not confirm phone availability or delivery/);
  assert.doesNotMatch(logs[0], /private-|962791234567/);
});

test('startup authentication failure reports HTTP status without rejecting or exposing credentials', async t => {
  const logs = configure(t);
  t.mock.method(globalThis, 'fetch', async () => ({
    ok: false, status: 401,
    json: async () => { throw new Error('Must not inspect private response'); },
  }));
  await assert.doesNotReject(checkSmsOnStartup());
  assert.deepEqual(logs, ['SMS startup check failed: SMSGate rejected the request (HTTP 401)']);
});

test('startup check distinguishes missing device registration and missing settings', async t => {
  const logs = configure(t);
  t.mock.method(globalThis, 'fetch', async () => ({ ok: true, json: async () => [] }));
  await checkSmsOnStartup();
  assert.match(logs[0], /No matching Android device is registered/);
  process.env.SMSGATE_PASSWORD = '';
  await checkSmsOnStartup();
  assert.match(logs[1], /Configure SMSGATE_USERNAME and SMSGATE_PASSWORD/);
});

test('diagnostics omit arbitrary private error messages and sanitize connection failures', async t => {
  const logs = configure(t);
  const privateMessage = 'private-test-password +962791234567 OTP 123456';
  assert.doesNotMatch(describeSmsFailure(new Error(privateMessage)), /private-|962791234567|123456/);
  t.mock.method(globalThis, 'fetch', async () => { throw new Error(privateMessage); });
  await checkSmsOnStartup();
  assert.match(logs[0], /Unable to reach the SMSGate API/);
  assert.doesNotMatch(logs[0], /private-|962791234567|123456/);
  process.env.SMS_PROVIDER = 'twilio';
  for (const [key, value] of Object.entries({
    TWILIO_ACCOUNT_SID: `AC${'0'.repeat(32)}`,
    TWILIO_AUTH_TOKEN: 'private-test-token', TWILIO_FROM_NUMBER: '+962791234567',
  })) {
    const original = process.env[key];
    process.env[key] = value;
    t.after(() => {
      if (original === undefined) delete process.env[key];
      else process.env[key] = original;
    });
  }
  await assert.rejects(getSmsProvider().sendOtp('+962791234567', '123456'), error => {
    assert.equal(describeSmsFailure(error), 'Unable to reach the Twilio SMS API');
    return true;
  });
});

test('startup check skips providers without an SMSGate connection check', async t => {
  const logs = configure(t);
  process.env.SMS_PROVIDER = 'twilio';
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected external request'); });
  await checkSmsOnStartup();
  assert.deepEqual(logs, []);
  assert.equal(globalThis.fetch.mock.callCount(), 0);
});
