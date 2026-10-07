const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.ADMIN_TOKEN_SECRET = 'network-test-admin-secret-'.repeat(3);
process.env.VISITOR_TOKEN_SECRET = 'network-test-visitor-secret-'.repeat(3);
process.env.RATE_LIMIT_HMAC_SECRET = 'network-test-rate-secret-'.repeat(3);

// The endpoint must not change event settings or contact the real database.
const pool = {
  query: async (sql) => {
    assert.match(sql, /(?:INSERT INTO|DELETE FROM) api_rate_limits/);
    return { rows: [{ hits: 1 }] };
  },
  connect: async () => { throw new Error('Network detection must not change event settings'); },
};
const connectionPath = require.resolve('../db/connection');
require.cache[connectionPath] = { id: connectionPath, filename: connectionPath, loaded: true, exports: pool };

const adminRoutes = require('../src/routes/admin.routes');
const { getCurrentNetwork } = require('../src/controllers/adminEvents.controller');
const { issueToken } = require('../src/services/tokens');

async function server(t, trustProxy) {
  const app = express();
  app.set('trust proxy', trustProxy);
  app.use('/api/admin', adminRoutes);
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  return `http://127.0.0.1:${listener.address().port}/api/admin/network`;
}

function token(role = 'admin') {
  return issueToken({ subject: 1, role, expiresInSeconds: 60 });
}

test('only administrators can detect the network through the protected route', async (t) => {
  const url = await server(t, 1);
  assert.equal((await fetch(url)).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${token('visitor')}` } })).status, 401);
  assert.equal((await fetch(url, { headers: { Authorization: `Bearer ${token()}` } })).status, 200);
});

test('network capture returns one exact IPv4 or IPv6 address and normalizes mapped IPv4', async (t) => {
  const url = await server(t, 1);
  for (const [forwarded, ip, cidr] of [
    ['203.0.113.9', '203.0.113.9', '203.0.113.9/32'],
    ['::ffff:203.0.113.9', '203.0.113.9', '203.0.113.9/32'],
    ['2001:db8:0:0::9', '2001:db8::9', '2001:db8::9/128'],
  ]) {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token()}`, 'X-Forwarded-For': forwarded },
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { success: true, data: { ip, cidr } });
  }
});

test('capture respects Express proxy trust and ignores supplied ranges and untrusted forwarded hops', async (t) => {
  const trusted = await server(t, 1);
  const response = await fetch(`${trusted}?ip=192.0.2.1&cidr=0.0.0.0/0`, {
    headers: { Authorization: `Bearer ${token()}`, 'X-Forwarded-For': '192.0.2.1, 203.0.113.8' },
  });
  assert.deepEqual((await response.json()).data, { ip: '203.0.113.8', cidr: '203.0.113.8/32' });

  const untrusted = await server(t, false);
  const direct = await fetch(untrusted, {
    headers: { Authorization: `Bearer ${token()}`, 'X-Forwarded-For': '203.0.113.8' },
  });
  assert.deepEqual((await direct.json()).data, { ip: '127.0.0.1', cidr: '127.0.0.1/32' });
});

test('missing or malformed client addresses fail without producing an approval range', () => {
  for (const ip of [undefined, '', 'invalid-address']) {
    const res = {
      status(code) { this.statusCode = code; return this; },
      json(body) { this.body = body; return this; },
    };
    getCurrentNetwork({ ip }, res);
    assert.equal(res.statusCode, 503);
    assert.equal(res.body.code, 'NETWORK_UNAVAILABLE');
    assert.equal(res.body.data, undefined);
  }
});
