const test = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');

process.env.NODE_ENV = 'test';
process.env.ADMIN_TOKEN_SECRET = 'presentation-test-admin-secret-'.repeat(3);
process.env.VISITOR_TOKEN_SECRET = 'presentation-test-visitor-secret-'.repeat(3);
process.env.RATE_LIMIT_HMAC_SECRET = 'presentation-test-rate-secret-'.repeat(3);

let eventExists = true;
let votingStatus = 'open';
const audits = [];
const pool = {
  query: async (sql, params) => {
    if (sql.includes('api_rate_limits')) return { rows: [{ hits: 1 }] };
    if (sql.includes('INSERT INTO audit_logs')) {
      audits.push(JSON.parse(params[4]));
      return { rows: [] };
    }
    if (sql === 'SELECT id FROM events WHERE id = $1') return { rows: eventExists ? [{ id: 1 }] : [], rowCount: eventExists ? 1 : 0 };
    if (sql.includes('AS "requireNetworkCheck"')) return { rows: [{ status: votingStatus, requireNetworkCheck: false, requireLocation: true }], rowCount: 1 };
    if (sql.includes('SELECT allowed_ip_ranges')) return { rows: [{ allowed_ip_ranges: null, location_enabled: true, location_ready: true }], rowCount: 1 };
    throw new Error(`Unexpected database query: ${sql}`);
  },
  connect: async () => { throw new Error('Presentation approval must not change venue settings'); },
};
const connectionPath = require.resolve('../db/connection');
require.cache[connectionPath] = { id: connectionPath, filename: connectionPath, loaded: true, exports: pool };

const { issueToken } = require('../src/services/tokens');
const { PRESENTATION_TTL_SECONDS, issuePresentationPass, verifyPresentationPass, readPresentationPass, presentationCookieName } = require('../src/services/presentationAccess');
const { checkVenueAccess } = require('../src/services/locationVerification');
const adminRoutes = require('../src/routes/admin.routes');
const { getVotingConfig } = require('../src/controllers/events.controller');
const venueAccess = require('../src/middleware/venueAccess.middleware');

async function server(t) {
  const app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
  app.get('/api/events/:eventId/config', getVotingConfig);
  app.get('/api/events/:eventId/venue-test', venueAccess, (req, res) => res.json({ success: true }));
  app.post('/api/events/:eventId/venue-test', venueAccess, (req, res) => res.json({ success: true }));
  const listener = app.listen(0, '127.0.0.1');
  await new Promise(resolve => listener.once('listening', resolve));
  t.after(() => new Promise(resolve => listener.close(resolve)));
  return `http://127.0.0.1:${listener.address().port}`;
}

function token(role = 'admin') {
  return issueToken({ subject: 1, role, expiresInSeconds: 60 });
}

test('presentation approvals are signed, restricted to one event, expire after 30 minutes, and cannot be login tokens', (t) => {
  const pass = issuePresentationPass(1, 1);
  assert.equal(verifyPresentationPass(pass, 1), true);
  assert.equal(verifyPresentationPass(pass, '1'), true);
  assert.equal(verifyPresentationPass(pass, 2), false);
  assert.equal(verifyPresentationPass(pass, undefined), false);
  assert.equal(verifyPresentationPass(token(), 1), false);
  assert.equal(verifyPresentationPass(pass + 'tampered', 1), false);
  const [payload, signature] = pass.split('.');
  const modified = { ...JSON.parse(Buffer.from(payload, 'base64url')), eventId: 2 };
  assert.equal(verifyPresentationPass(`${Buffer.from(JSON.stringify(modified)).toString('base64url')}.${signature}`, 2), false);
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + PRESENTATION_TTL_SECONDS * 1000);
  assert.equal(verifyPresentationPass(pass, 1), false);
});

test('presentation cookies are event-specific; duplicated cookies cannot authorize a browser', () => {
  const pass = issuePresentationPass(1, 1);
  const cookie = `${presentationCookieName(1)}=${pass}`;
  assert.equal(readPresentationPass({ headers: { cookie: `unrelated=value; ${cookie}` } }, 1), pass);
  assert.equal(readPresentationPass({ headers: { cookie } }, 2), undefined);
  assert.equal(readPresentationPass({ headers: { cookie: `${cookie}; ${cookie}` } }, 1), undefined);
  assert.equal(readPresentationPass({ body: { presentationPass: pass } }, 1), undefined);
});

test('only authenticated admins can approve this browser, with a secure private cookie and no pass in the JSON response', async (t) => {
  const base = await server(t);
  const url = `${base}/api/admin/events/1/presentation`;
  for (const auth of [undefined, token('visitor')]) {
    const response = await fetch(url, { method: 'POST', headers: auth ? { Authorization: `Bearer ${auth}` } : {} });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('set-cookie'), null);
  }
  const previous = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  t.after(() => { process.env.NODE_ENV = previous; });
  const response = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: { expiresInSeconds: 1800 } });
  const cookie = response.headers.get('set-cookie');
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /Secure/);
  assert.match(cookie, /SameSite=Strict/);
  assert.match(cookie, /Path=\/api\/events\/1/);
  assert.match(cookie, /Max-Age=1800/);
  assert.doesNotMatch(cookie, /Domain=/);
  assert.equal(verifyPresentationPass(readPresentationPass({ headers: { cookie: cookie.split(';')[0] } }, 1), 1), true);
  assert.deepEqual(audits.at(-1), { method: 'POST', action: '/events/:id/presentation', eventId: 1 });
});

test('unknown and invalid events cannot issue presentation cookies', async (t) => {
  const base = await server(t);
  const headers = { Authorization: `Bearer ${token()}` };
  const invalid = await fetch(`${base}/api/admin/events/bad/presentation`, { method: 'POST', headers });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('set-cookie'), null);
  eventExists = false;
  t.after(() => { eventExists = true; });
  const missing = await fetch(`${base}/api/admin/events/1/presentation`, { method: 'POST', headers });
  assert.equal(missing.status, 404);
  assert.equal(missing.headers.get('set-cookie'), null);
});

test('the approved browser passes the real silent venue route, while ordinary browsers, wrong events and body overrides do not', async (t) => {
  const base = await server(t);
  const approval = await fetch(`${base}/api/admin/events/1/presentation`, { method: 'POST', headers: { Authorization: `Bearer ${token()}` } });
  const cookie = approval.headers.get('set-cookie').split(';')[0];
  const configUrl = `${base}/api/events/1/config`;
  assert.equal((await (await fetch(configUrl)).json()).data.requirePresentationCheck, false);
  const config = await (await fetch(configUrl, { headers: { Cookie: cookie } })).json();
  assert.equal(config.data.requirePresentationCheck, true);
  assert.equal(config.data.requireLocation, true);
  assert.equal(config.data.requireNetworkCheck, false);
  assert.equal((await fetch(`${base}/api/events/1/venue-test`, { headers: { Cookie: cookie } })).status, 200);
  assert.equal((await fetch(`${base}/api/events/1/venue-test`)).status, 403);
  assert.equal((await fetch(`${base}/api/events/2/venue-test`, { headers: { Cookie: cookie } })).status, 403);
  const bodyOverride = await fetch(`${base}/api/events/1/venue-test`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ presentationPass: cookie.split('=')[1] }),
  });
  assert.equal(bodyOverride.status, 403);
  votingStatus = 'closed';
  t.after(() => { votingStatus = 'open'; });
  assert.equal((await (await fetch(configUrl, { headers: { Cookie: cookie } })).json()).data.status, 'closed');
});

test('invalid or expired presentation approvals fall back to normal venue enforcement', async (t) => {
  const settings = { allowed_ip_ranges: null, location_enabled: true, location_ready: true };
  const pass = issuePresentationPass(1, 1);
  const args = { eventId: 1, settings, presentationPass: pass };
  assert.deepEqual(await checkVenueAccess(pool, args), { allowed: true, method: 'presentation' });
  assert.equal((await checkVenueAccess(pool, { ...args, presentationPass: 'invalid' })).code, 'LOCATION_REQUIRED');
  const now = Date.now();
  t.mock.method(Date, 'now', () => now + PRESENTATION_TTL_SECONDS * 1000);
  assert.equal((await checkVenueAccess(pool, args)).code, 'LOCATION_REQUIRED');
});
