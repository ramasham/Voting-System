const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db/connection');
const content = require('../src/controllers/adminContent.controller');
const events = require('../src/controllers/adminEvents.controller');
const media = require('../src/controllers/media.controller');

function response() {
  return {
    statusCode: 200,
    headers: {},
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; },
    send(body) { this.body = body; return this; },
    end() { return this; },
    setHeader(key, value) { this.headers[key] = value; },
  };
}

function database(t, answers) {
  const calls = [];
  const query = async (sql, values) => {
    sql = sql.replace(/\s+/g, ' ').trim();
    calls.push({ sql, values });
    if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return { rows: [], rowCount: 0 };
    const answer = answers.shift();
    assert.ok(answer, `Unexpected query: ${sql}`);
    assert.match(sql, answer.match);
    if (answer.check) answer.check(values);
    if (answer.error) throw answer.error;
    return { rows: answer.rows || [], rowCount: answer.rowCount ?? answer.rows?.length ?? 0 };
  };
  const client = { query, release: t.mock.fn() };
  t.mock.method(pool, 'connect', async () => client);
  t.mock.method(pool, 'query', query);
  t.after(() => assert.equal(answers.length, 0, 'Every expected query must execute'));
  return { calls, client };
}

const eventRequest = { params: { eventId: '1' } };
const eventRow = { match: /SELECT id FROM events.*FOR NO KEY UPDATE/, rows: [{ id: 1 }] };
const ensureRow = { match: /INSERT INTO event_settings/ };
const configured = {
  voting_start_at: '2099-01-01T10:00:00Z',
  voting_end_at: '2099-01-01T12:00:00Z',
  window_not_ended: true,
  allowed_ip_ranges: '10.0.0.0/8',
  location_enabled: false,
  location_ready: false,
};

test('a fourth award category is rejected without inserting it', async (t) => {
  const db = database(t, [eventRow, { match: /COUNT\(\*\)/, rows: [{ count: 3 }] }]);
  const res = response();
  await content.createCategory({ ...eventRequest, body: { name: 'Fourth', displayOrder: 4 } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CATEGORY_LIMIT_REACHED');
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(db.client.release.mock.callCount(), 1);
});

test('an exhibitor cannot be updated to have no categories', async (t) => {
  database(t, []);
  const res = response();
  await content.updateExhibitor({ params: { eventId: '1', exhibitorId: '2' }, body: { categoryIds: [] } }, res);
  assert.equal(res.statusCode, 400);
  assert.match(res.body.message, /non-empty/);
});

test('categories cannot be deleted while voting is enabled', async (t) => {
  database(t, [eventRow, { match: /SELECT voting_enabled.*FOR UPDATE/, rows: [{ voting_enabled: true }] }]);
  const res = response();
  await content.deleteCategory({ params: { eventId: '1', categoryId: '3' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'VOTING_MUST_BE_CLOSED');
});

test('deleting an exhibitor with votes is rejected after locking the exhibitor', async (t) => {
  const db = database(t, [
    { match: /SELECT id FROM exhibitors.*FOR UPDATE/, rows: [{ id: 2 }] },
    { match: /SELECT EXISTS.*FROM votes/, rows: [{ has_votes: true }] },
  ]);
  const res = response();
  await content.deleteExhibitor({ params: { eventId: '1', exhibitorId: '2' } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'EXHIBITOR_HAS_VOTES');
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
});

test('an exhibitor category that has votes cannot be removed', async (t) => {
  const db = database(t, [
    { match: /SELECT id FROM exhibitors.*FOR UPDATE/, rows: [{ id: 2 }] },
    { match: /SELECT id FROM categories/, rows: [{ id: 3 }] },
    { match: /SELECT category_id FROM exhibitor_category_assignments/, rows: [{ category_id: 3 }, { category_id: 4 }] },
    { match: /SELECT EXISTS.*FROM votes/, rows: [{ has_votes: true }], check: (v) => assert.deepEqual(v, [1, 2, [4]]) },
  ]);
  const res = response();
  await content.updateExhibitor({ params: { eventId: '1', exhibitorId: '2' }, body: { categoryIds: [3] } }, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'CATEGORY_ASSIGNMENT_HAS_VOTES');
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
});

test('reset is rejected while voting is enabled', async (t) => {
  const db = database(t, [eventRow, { match: /SELECT voting_enabled.*FOR UPDATE/, rows: [{ voting_enabled: true }] }]);
  const res = response();
  await events.resetResults(eventRequest, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'VOTING_MUST_BE_CLOSED');
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
});

test('reset deletes only the selected event votes after locking settings', async (t) => {
  const db = database(t, [
    eventRow,
    { match: /SELECT voting_enabled.*FOR UPDATE/, rows: [{ voting_enabled: false }] },
    { match: /^DELETE FROM votes WHERE event_id = \$1$/, rowCount: 7, check: (values) => assert.deepEqual(values, [1]) },
  ]);
  const res = response();
  await events.resetResults(eventRequest, res);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.body.data, { eventId: 1, deletedVotes: 7 });
  assert.equal(db.calls.at(-1).sql, 'COMMIT');
});

test('opening voting requires exactly three categories', async (t) => {
  database(t, [eventRow, ensureRow,
    { match: /SELECT.*window_not_ended.*FOR UPDATE/, rows: [configured] },
    { match: /SELECT c.id, EXISTS/, rows: [{ id: 1, has_exhibitors: true }] },
  ]);
  const res = response();
  await events.openVoting(eventRequest, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'THREE_CATEGORIES_REQUIRED');
});

test('a future schedule can be enabled using a ready geofence without IP ranges', async (t) => {
  const db = database(t, [eventRow, ensureRow,
    { match: /SELECT.*window_not_ended.*FOR UPDATE/, rows: [{ ...configured, allowed_ip_ranges: null, location_enabled: true, location_ready: true }] },
    { match: /SELECT c.id, EXISTS/, rows: [1, 2, 3].map((id) => ({ id, has_exhibitors: true })) },
    { match: /UPDATE event_settings SET voting_enabled = TRUE/, rows: [{ event_id: 1, voting_enabled: true }] },
  ]);
  const res = response();
  await events.openVoting(eventRequest, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.voting_enabled, true);
  assert.equal(db.calls.at(-1).sql, 'COMMIT');
});

test('opening with an unready geofence and no network restriction is rejected', async (t) => {
  database(t, [eventRow, ensureRow,
    { match: /SELECT.*window_not_ended.*FOR UPDATE/, rows: [{ ...configured, allowed_ip_ranges: null, location_enabled: true }] },
  ]);
  const res = response();
  await events.openVoting(eventRequest, res);
  assert.equal(res.statusCode, 409);
  assert.equal(res.body.code, 'VENUE_ACCESS_REQUIRED');
});

test('a partial voting schedule update is compared with locked existing settings', async (t) => {
  const db = database(t, [eventRow, ensureRow,
    { match: /SELECT voting_start_at, voting_end_at.*FOR UPDATE/, rows: [configured] },
  ]);
  const res = response();
  await events.updateSettings({ ...eventRequest, body: { votingEndAt: '2099-01-01T09:00:00Z' } }, res);
  assert.equal(res.statusCode, 400);
  assert.equal(res.body.code, 'INVALID_VOTING_WINDOW');
  assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
});

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const photoRequest = { params: { eventId: '1', exhibitorId: '2' }, headers: { 'content-type': 'image/png' }, body: png };

test('photo upload rejects HTML and mismatched image MIME types', async (t) => {
  database(t, []);
  for (const request of [
    { ...photoRequest, body: Buffer.from('<svg onload="alert(1)"></svg>') },
    { ...photoRequest, headers: { 'content-type': 'image/jpeg' } },
  ]) {
    const res = response();
    await media.uploadExhibitorPhoto(request, res);
    assert.equal(res.statusCode, 415);
  }
});

test('photo upload rejects images exceeding the size limit', async (t) => {
  database(t, []);
  const res = response();
  await media.uploadExhibitorPhoto({ ...photoRequest, body: Buffer.alloc(media.MAX_PHOTO_BYTES + 1) }, res);
  assert.equal(res.statusCode, 413);
});

test('photo upload scopes the exhibitor to the event and stores bytes transactionally', async (t) => {
  const db = database(t, [
    { match: /SELECT id FROM exhibitors WHERE event_id = \$1 AND id = \$2 FOR UPDATE/, rows: [{ id: 2 }], check: (v) => assert.deepEqual(v, [1, 2]) },
    { match: /INSERT INTO exhibitor_photos/, check: (v) => assert.deepEqual(v, [2, 'image/png', png]) },
    { match: /UPDATE exhibitors SET image_url/, check: (v) => assert.deepEqual(v, [1, 2, '/api/media/exhibitors/2/photo']) },
  ]);
  const res = response();
  await media.uploadExhibitorPhoto(photoRequest, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.body.data.imageUrl, '/api/media/exhibitors/2/photo');
  assert.equal(db.calls.at(-1).sql, 'COMMIT');
});

test('uploaded photos are served with safe image headers and conditional caching', async (t) => {
  database(t, [
    { match: /SELECT content_type, image_data/, rows: [{ content_type: 'image/png', image_data: png }] },
    { match: /SELECT content_type, image_data/, rows: [{ content_type: 'image/png', image_data: png }] },
  ]);
  const res = response();
  await media.getExhibitorPhoto(photoRequest, res);
  assert.equal(res.statusCode, 200);
  assert.equal(res.headers['Content-Type'], 'image/png');
  assert.equal(res.headers['X-Content-Type-Options'], 'nosniff');
  assert.deepEqual(res.body, png);
  const cached = response();
  await media.getExhibitorPhoto({ ...photoRequest, headers: { 'if-none-match': res.headers.ETag } }, cached);
  assert.equal(cached.statusCode, 304);
});

test('CSV export includes zero-vote entrants and neutralizes spreadsheet formulas', async (t) => {
  database(t, [
    { match: /SELECT id, name FROM events/, rows: [{ id: 1, name: 'Awards' }] },
    { match: /SELECT c.id AS category_id/, rows: [
      { category_id: 1, category_name: '=1+1', exhibitor_id: 2, exhibitor_name: 'Maker, "A"', vote_count: 0 },
      { category_id: 2, category_name: 'Empty', exhibitor_id: null, exhibitor_name: null, vote_count: 0 },
    ] },
  ]);
  const res = response();
  await events.exportResults(eventRequest, res);
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['Content-Disposition'], /event-1-results\.csv/);
  assert.ok(res.body.includes('"1","\'=1+1","2","Maker, ""A""","0"'));
  assert.ok(res.body.includes('"2","Empty","","","0"'));
});
