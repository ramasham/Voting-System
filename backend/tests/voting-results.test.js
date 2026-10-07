const test = require('node:test');
const assert = require('node:assert/strict');
const pool = require('../db/connection');
const { castVote, getVisitorVotes } = require('../src/services/vote.service');
const { getResults } = require('../src/modules/results/results.service');

const selection = { eventId: 1, categoryId: 2, exhibitorId: 3, visitorId: 4, clientIp: '127.0.0.1' };
const settings = { voting_enabled: true, window_started: true, window_not_ended: true,
    allowed_ip_ranges: '127.0.0.0/8', location_enabled: false, location_ready: false };
const receipt = { id: 10, event_id: 1, category_id: 2, exhibitor_id: 3, created_at: '2026-10-07T00:00:00Z' };
const rows = (values) => ({ rows: values, rowCount: values.length });

function database(t, options = {}) {
    const calls = [];
    let released = false;
    const client = {
        async query(sql, params) {
            calls.push({ sql, params });
            if (['BEGIN', 'COMMIT', 'ROLLBACK'].includes(sql)) return rows([]);
            if (sql.includes('INSERT INTO votes')) {
                if (options.insertError) throw options.insertError;
                return rows(options.windowEnded ? [] : [receipt]);
            }
            if (sql.includes('FROM events')) return rows([{ id: 1 }]);
            if (sql.includes('FROM event_settings')) return rows([options.settings || settings]);
            if (sql.includes('FROM visitors')) return rows([{ phone_verified: options.verified !== false }]);
            if (sql.includes('FROM categories')) return rows([{ id: 2 }]);
            if (sql.includes('FROM exhibitors')) return rows([{ id: 3 }]);
            if (sql.includes('FROM votes')) return rows(options.previous || []);
            if (sql.includes('FROM exhibitor_category_assignments')) return rows(options.invalidAssignment ? [] : [{ exhibitor_id: 3 }]);
            throw new Error(`Unexpected query: ${sql}`);
        },
        release() { released = true; },
    };
    t.mock.method(pool, 'connect', async () => client);
    return { calls, get released() { return released; } };
}

test('HTTP vote routes load and expose both creation and prior-vote reads', () => {
    const router = require('../src/routes/votes.routes');
    assert.ok(router.stack.some((layer) => layer.route?.methods.get));
    assert.ok(router.stack.some((layer) => layer.route?.methods.post));
});

test('a valid verified venue vote commits and releases its connection', async (t) => {
    const db = database(t);
    assert.deepEqual(await castVote(selection), { ...receipt, replayed: false });
    assert.match(db.calls.find((entry) => entry.sql.includes('FROM visitors')).sql, /FOR UPDATE/);
    assert.equal(db.calls.at(-1).sql, 'COMMIT');
    assert.equal(db.released, true);
});

test('an approved network can cast a vote without GPS even when location verification is enabled', async (t) => {
    const db = database(t, { settings: { ...settings, location_enabled: true, location_ready: true } });
    assert.deepEqual(await castVote(selection), { ...receipt, replayed: false });
    assert.equal(db.calls.some((entry) => entry.sql.includes('ST_Covers')), false);
    assert.equal(db.calls.at(-1).sql, 'COMMIT');
    assert.equal(db.released, true);
});

test('an identical retry returns the original receipt after voting closes without inserting again', async (t) => {
    const db = database(t, { previous: [receipt], settings: { ...settings, voting_enabled: false } });
    assert.deepEqual(await castVote({ ...selection, clientIp: '192.0.2.10' }), { ...receipt, replayed: true });
    assert.equal(db.calls.some((entry) => entry.sql.includes('INSERT INTO votes')), false);
    assert.equal(db.calls.at(-1).sql, 'COMMIT');
    assert.equal(db.released, true);
});

test('changing a previously recorded category selection rolls back with a duplicate error', async (t) => {
    const db = database(t, { previous: [receipt] });
    await assert.rejects(castVote({ ...selection, exhibitorId: 9 }), { code: 'DUPLICATE_VOTE', status: 409 });
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(db.released, true);
});

test('a fourth selection is rejected even if more categories exist in legacy data', async (t) => {
    const db = database(t, { previous: [1, 2, 3].map((id) => ({ ...receipt, category_id: id })) });
    await assert.rejects(castVote({ ...selection, categoryId: 4 }), { code: 'VOTE_LIMIT_REACHED', status: 409 });
    assert.equal(db.calls.some((entry) => entry.sql.includes('INSERT INTO votes')), false);
});

for (const scenario of [
    { name: 'unverified phone', options: { verified: false }, code: 'PHONE_NOT_VERIFIED' },
    { name: 'closed voting', options: { settings: { ...settings, voting_enabled: false } }, code: 'VOTING_CLOSED' },
    { name: 'outside venue', vote: { clientIp: '192.0.2.10' }, code: 'OUTSIDE_VENUE' },
    { name: 'unassigned exhibitor', options: { invalidAssignment: true }, code: 'INVALID_CATEGORY_EXHIBITOR' },
]) {
    test(`${scenario.name} cannot create a vote`, async (t) => {
        const db = database(t, scenario.options);
        await assert.rejects(castVote({ ...selection, ...scenario.vote }), { code: scenario.code });
        assert.equal(db.calls.some((entry) => entry.sql.includes('INSERT INTO votes')), false);
        assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
        assert.equal(db.released, true);
    });
}

test('database errors roll back and always release the transaction connection', async (t) => {
    const db = database(t, { insertError: new Error('connection lost') });
    await assert.rejects(castVote(selection), /connection lost/);
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(db.released, true);
});

test('a window that ends while locks are acquired cannot accept a delayed vote', async (t) => {
    const db = database(t, { windowEnded: true });
    await assert.rejects(castVote(selection), { code: 'VOTING_CLOSED', status: 403 });
    const insertion = db.calls.find((entry) => entry.sql.includes('INSERT INTO votes'));
    assert.match(insertion.sql, /clock_timestamp\(\) < voting_end_at/);
    assert.equal(db.calls.at(-1).sql, 'ROLLBACK');
    assert.equal(db.released, true);
});

test('prior-vote reads are scoped to authenticated visitor and omit visitor personal data', async (t) => {
    const calls = [];
    t.mock.method(pool, 'query', async (sql, params) => {
        calls.push({ sql, params });
        return sql.includes('FROM events') ? rows([{ id: 1 }]) : rows([receipt]);
    });
    assert.deepEqual(await getVisitorVotes({ eventId: 1, visitorId: 4 }), [receipt]);
    assert.deepEqual(calls[1].params, [1, 4]);
    assert.match(calls[1].sql, /visitor_id = \$2/);
    assert.doesNotMatch(calls[1].sql, /phone_number|name/);
});

test('results include empty categories and zero-vote exhibitors in database rank order', async (t) => {
    t.mock.method(pool, 'query', async (sql, params) => {
        assert.deepEqual(params, [1]);
        if (sql.includes('FROM events')) return rows([{ id: 1, name: 'MC2026', total_votes: 8, total_visitors: 5 }]);
        assert.match(sql, /COUNT\(v.id\) DESC/);
        return rows([
            { category_id: 2, category_name: 'Design', exhibitor_id: 3, exhibitor_name: 'A', image_url: '/a.png', vote_count: 8 },
            { category_id: 2, category_name: 'Design', exhibitor_id: 4, exhibitor_name: 'B', image_url: null, vote_count: 0 },
            { category_id: 5, category_name: 'Innovation', exhibitor_id: null, vote_count: 0 },
        ]);
    });
    const data = await getResults(1);
    assert.deepEqual(data.categories[0].exhibitors.map((entry) => entry.votes), [8, 0]);
    assert.equal(data.categories[0].totalVotes, 8);
    assert.deepEqual(data.categories[1].exhibitors, []);
    assert.equal(data.event, 'MC2026');
    assert.equal(data.totalVotes, 8);
    assert.equal(data.totalVisitors, 5);
    assert.ok(!JSON.stringify(data).includes('phone_number'));
});
