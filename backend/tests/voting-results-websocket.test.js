const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const pool = require('../db/connection');
const notifier = require('../src/services/resultsNotifier');
const voteService = require('../src/services/vote.service');
const { voteRateLimit } = require('../src/middleware/rateLimit.middleware');
const { issueToken } = require('../src/services/tokens');

process.env.VISITOR_TOKEN_SECRET = 'test-visitor-secret-with-at-least-32-characters';
process.env.ADMIN_TOKEN_SECRET = 'test-admin-secret-with-at-least-32-characters';

class FakeServer extends EventEmitter {
    clients = new Set();
}
class FakeSocket extends EventEmitter {
    readyState = 1;
    bufferedAmount = 0;
    sent = [];
    send(message) { this.sent.push(JSON.parse(message)); }
    close() { this.readyState = 3; this.emit('close'); }
    terminate() { this.close(); }
    ping() {}
    async message(value) {
        this.emit('message', Buffer.from(JSON.stringify(value)), false);
        await this.messageQueue;
    }
}

function setup(t) {
    t.mock.method(notifier, 'start', () => {});
    t.mock.method(notifier, 'stop', async () => {});
    t.mock.method(pool, 'query', async () => ({ rowCount: 1, rows: [{ id: 1 }] }));
    const limit = t.mock.method(voteRateLimit, 'consume', async () => ({ allowed: true }));
    const vote = t.mock.method(voteService, 'castVote', async () => ({ event_id: 1, category_id: 2, exhibitor_id: 3, replayed: true }));
    const wsPath = require.resolve('ws');
    const original = require(wsPath);
    require.cache[wsPath].exports = { OPEN: 1, WebSocketServer: FakeServer };
    const servicePath = require.resolve('../src/services/webSocketServer');
    delete require.cache[servicePath];
    const { attachWebSocketServer } = require(servicePath);
    require.cache[wsPath].exports = original;
    const server = attachWebSocketServer({});
    const socket = new FakeSocket();
    server.clients.add(socket);
    server.emit('connection', socket, { socket: { remoteAddress: '127.0.0.1' } });
    t.after(() => { socket.close(); server.emit('close'); });
    const auth = async (role) => {
        const token = issueToken({ role, subject: 4, expiresInSeconds: 60 });
        await socket.message({ type: 'AUTH', token });
    };
    return { socket, auth, limit, vote };
}

test('results subscriptions require an administrator token', async (t) => {
    const { socket, auth } = setup(t);
    await socket.message({ type: 'SUBSCRIBE_RESULTS', eventId: 1 });
    assert.equal(socket.sent.at(-1).code, 'AUTHENTICATION_REQUIRED');
    await auth('visitor');
    await socket.message({ type: 'SUBSCRIBE_RESULTS', eventId: 1 });
    assert.equal(socket.sent.at(-1).code, 'ADMIN_AUTH_REQUIRED');
    assert.equal(socket.resultSubscriptions.size, 0);
});

test('admin subscriptions refresh immediately and are removed when reauthenticated as visitor', async (t) => {
    const { socket, auth } = setup(t);
    await auth('admin');
    await socket.message({ type: 'SUBSCRIBE_RESULTS', eventId: 1 });
    assert.equal(socket.resultSubscriptions.has(1), true);
    assert.equal(socket.sent.at(-1).type, 'RESULTS_UPDATED');
    await auth('visitor');
    assert.equal(socket.resultSubscriptions.size, 0);
});

test('expired websocket credentials cannot keep results access', async (t) => {
    const { socket, auth } = setup(t);
    await auth('admin');
    await socket.message({ type: 'SUBSCRIBE_RESULTS', eventId: 1 });
    socket.auth.expiresAt = 0;
    await socket.message({ type: 'SUBSCRIBE_RESULTS', eventId: 1 });
    assert.equal(socket.sent.at(-1).code, 'AUTHENTICATION_REQUIRED');
    assert.equal(socket.resultSubscriptions.size, 0);
});

test('websocket vote retries use the shared service and per-visitor quota', async (t) => {
    const { socket, auth, limit, vote } = setup(t);
    await auth('visitor');
    await socket.message({ type: 'CAST_VOTE', eventId: 1, categoryId: 2, exhibitorId: 3 });
    assert.deepEqual(limit.mock.calls[0].arguments, ['visitor:4']);
    assert.equal(vote.mock.calls[0].arguments[0].clientIp, '127.0.0.1');
    assert.equal(socket.sent.at(-1).type, 'VOTE_ACCEPTED');
    assert.equal(socket.sent.at(-1).replayed, true);
});

test('unknown event subscriptions are rejected without storing subscriptions', async (t) => {
    const { socket, auth } = setup(t);
    t.mock.method(pool, 'query', async () => ({ rows: [], rowCount: 0 }));
    await auth('admin');
    await socket.message({ type: 'SUBSCRIBE_RESULTS', eventId: 9 });
    assert.equal(socket.sent.at(-1).code, 'EVENT_NOT_FOUND');
    assert.equal(socket.resultSubscriptions.size, 0);
});

test('slow websocket consumers cannot grow the output buffer without a bound', async (t) => {
    const { socket, auth } = setup(t);
    socket.bufferedAmount = 65537;
    await auth('admin');
    assert.equal(socket.readyState, 3);
});
