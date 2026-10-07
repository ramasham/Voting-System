const test = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate: flush } = require('node:timers/promises');
const { trackSmsDelivery, stopSmsDeliveryChecks } = require('../src/services/smsDiagnostics');

function setup(t, implementation) {
  stopSmsDeliveryChecks();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(stopSmsDeliveryChecks);
  const logs = [];
  t.mock.method(console, 'info', message => logs.push(message));
  t.mock.method(console, 'error', message => logs.push(message));
  return { logs, provider: { mode: 'cloud', getMessageStatus: t.mock.fn(implementation) } };
}

test('delivery checks follow the accepted message twice without resending it or retaining private message fields', async t => {
  let calls = 0;
  const { provider, logs } = setup(t, async id => {
    assert.equal(id, 'gateway-message-id');
    return { state: ++calls === 1 ? 'Sent' : 'Delivered' };
  });
  trackSmsDelivery(provider, { id: 'gateway-message-id', state: 'Pending', text: 'OTP 123456', phoneNumber: '+962791234567' }, 7);
  t.mock.timers.tick(14999);
  assert.equal(calls, 0);
  t.mock.timers.tick(1);
  await flush();
  assert.equal(calls, 1);
  t.mock.timers.tick(29999);
  assert.equal(calls, 1);
  t.mock.timers.tick(1);
  await flush();
  t.mock.timers.tick(120000);
  await flush();
  assert.equal(calls, 2);
  assert.ok(logs.includes('SMS delivery status (verification 7): Sent'));
  assert.ok(logs.includes('SMS delivery status (verification 7): Delivered'));
  assert.doesNotMatch(logs.join('\n'), /gateway-message-id|123456|962791234567/);
});

test('a terminal delivery failure stops polling and reports its fixed reason', async t => {
  const { provider, logs } = setup(t, async () => ({ state: 'Failed', reason: 'SMS_PERMISSION_DENIED' }));
  trackSmsDelivery(provider, { id: 'id', state: 'Pending' }, 7);
  t.mock.timers.tick(15000);
  await flush();
  t.mock.timers.tick(120000);
  await flush();
  assert.equal(provider.getMessageStatus.mock.callCount(), 1);
  assert.ok(logs.includes('SMS delivery status (verification 7): Failed (SMS_PERMISSION_DENIED)'));
});

test('a pending message has a bounded number of checks', async t => {
  const { provider, logs } = setup(t, async () => ({ state: 'Pending' }));
  trackSmsDelivery(provider, { id: 'id', state: 'Pending' }, 7);
  t.mock.timers.tick(15000);
  await flush();
  t.mock.timers.tick(30000);
  await flush();
  t.mock.timers.tick(120000);
  await flush();
  assert.equal(provider.getMessageStatus.mock.callCount(), 2);
  assert.equal(logs.filter(message => message.endsWith(': Pending')).length, 2);
});

test('delivery lookup errors are private and do not cause unhandled rejections or retries', async t => {
  const { provider, logs } = setup(t, async () => { throw new Error('test-password +962791234567 OTP 123456'); });
  trackSmsDelivery(provider, { id: 'id', state: 'Pending' }, 7);
  t.mock.timers.tick(15000);
  await flush();
  t.mock.timers.tick(120000);
  await flush();
  assert.equal(provider.getMessageStatus.mock.callCount(), 1);
  assert.ok(logs.some(message => message.startsWith('SMS delivery check failed')));
  assert.doesNotMatch(logs.join('\n'), /test-password|962791234567|123456/);
});

test('shutdown cancels timers and prevents in-flight lookups from scheduling further checks', async t => {
  let resolveStatus;
  const { provider, logs } = setup(t, () => new Promise(resolve => { resolveStatus = resolve; }));
  trackSmsDelivery(provider, { id: 'id', state: 'Pending' }, 7);
  t.mock.timers.tick(15000);
  assert.equal(provider.getMessageStatus.mock.callCount(), 1);
  stopSmsDeliveryChecks();
  resolveStatus({ state: 'Pending' });
  await flush();
  t.mock.timers.tick(120000);
  await flush();
  assert.equal(provider.getMessageStatus.mock.callCount(), 1);
  assert.equal(logs.length, 1);
  trackSmsDelivery(provider, { id: 'second', state: 'Pending' }, 8);
  stopSmsDeliveryChecks();
  t.mock.timers.tick(120000);
  assert.equal(provider.getMessageStatus.mock.callCount(), 1);
});

test('diagnostic capacity is bounded and completed checks release their capacity', async t => {
  const { provider, logs } = setup(t, async () => ({ state: 'Delivered' }));
  for (let id = 1; id <= 250; id++) trackSmsDelivery(provider, { id: `id-${id}`, state: 'Pending' }, id);
  t.mock.timers.tick(15000);
  await flush();
  assert.equal(provider.getMessageStatus.mock.callCount(), 200);
  assert.equal(logs.filter(message => message.includes('diagnostic capacity reached')).length, 50);
  trackSmsDelivery(provider, { id: 'next-message', state: 'Pending' }, 251);
  t.mock.timers.tick(15000);
  await flush();
  assert.equal(provider.getMessageStatus.mock.callCount(), 201);
});

test('delivery diagnostics skip other providers and already completed messages', async t => {
  const { provider, logs } = setup(t, () => { throw new Error('Must not check this message'); });
  trackSmsDelivery({ ...provider, mode: 'local' }, { id: 'id', state: 'Pending' }, 7);
  trackSmsDelivery(provider, undefined, 7);
  trackSmsDelivery(provider, { id: 'id', state: 'Pending' }, 'private input');
  trackSmsDelivery(provider, { id: 'id', state: 'Delivered' }, 7);
  t.mock.timers.tick(120000);
  assert.equal(provider.getMessageStatus.mock.callCount(), 0);
  assert.equal(logs.length, 1);
});
