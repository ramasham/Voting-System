const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const express = require('express');
const { serveFrontend } = require('../src/services/serveFrontend');

test('hosted frontend serves phone entry routes and assets without replacing API responses', async (t) => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'voting-frontend-test-'));
  t.after(() => fs.rm(directory, { recursive: true, force: true }));
  await fs.mkdir(path.join(directory, 'assets'));
  await fs.writeFile(path.join(directory, 'index.html'), '<!doctype html><main>Voting app</main>');
  await fs.writeFile(path.join(directory, 'assets', 'app.js'), 'console.log("voting")');
  await fs.writeFile(path.join(directory, '.env'), 'private-test-sentinel');
  const app = express();
  app.get('/api/events', (req, res) => res.json({ success: true, data: [{ id: 7 }] }));
  app.use('/api', (req, res) => res.status(404).json({ success: false }));
  serveFrontend(app, directory);
  const server = app.listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  for (const route of ['/', '/?event=7', '/admin', '/admin/', '/results']) {
    const res = await fetch(base + route);
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/html/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.match(await res.text(), /Voting app/);
  }
  assert.equal((await fetch(base + '/assets/app.js')).status, 200);
  assert.deepEqual(await (await fetch(base + '/api/events')).json(), { success: true, data: [{ id: 7 }] });
  const missing = await fetch(base + '/api/unknown');
  assert.equal(missing.status, 404);
  assert.match(missing.headers.get('content-type'), /application\/json/);
  for (const route of ['/.env', '/assets/missing.js', '/missing']) {
    const res = await fetch(base + route);
    assert.ok(res.status >= 400);
    assert.doesNotMatch(await res.text(), /private-test-sentinel|Voting app/);
  }
});

test('hosted server requires an actual frontend build', () => {
  assert.throws(() => serveFrontend(express(), '/nonexistent/voting-frontend'), /Frontend build is missing/);
});
