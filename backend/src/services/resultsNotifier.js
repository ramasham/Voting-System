const { Client } = require('pg');
const pool = require('../../db/connection');

const CHANNEL = 'voting_results';
const subscribersByEvent = new Map();
let listener;
let reconnectTimer;
let running = false;

function subscribe(socket, eventId) {
    let subscribers = subscribersByEvent.get(eventId);
    if (!subscribers) {
        subscribers = new Set();
        subscribersByEvent.set(eventId, subscribers);
    }
    subscribers.add(socket);
    socket.resultSubscriptions.add(eventId);
}

function removeSocket(socket) {
    for (const eventId of socket.resultSubscriptions || []) {
        const subscribers = subscribersByEvent.get(eventId);
        if (!subscribers) continue;
        subscribers.delete(socket);
        if (subscribers.size === 0) subscribersByEvent.delete(eventId);
    }
    if (socket.resultSubscriptions) socket.resultSubscriptions.clear();
}

function broadcast(eventId) {
    const subscribers = subscribersByEvent.get(eventId);
    if (!subscribers) return;
    const message = JSON.stringify({ type: 'RESULTS_UPDATED', eventId, timestamp: new Date().toISOString() });
    for (const socket of subscribers) {
        if (socket.readyState !== 1 || socket.auth?.role !== 'admin' || socket.auth.expiresAt <= Date.now() / 1000) {
            removeSocket(socket);
            continue;
        }
        if (socket.bufferedAmount > 64 * 1024) {
            removeSocket(socket);
            socket.terminate();
            continue;
        }
        try {
            socket.send(message);
        } catch {
            removeSocket(socket);
            socket.terminate();
        }
    }
}

function reconnect(client, error) {
    if (listener !== client) return;
    listener = null;
    client.end().catch(() => {});
    if (!running) return;
    if (error) console.error('Results notification connection failed:', error.message);
    reconnectTimer = setTimeout(connect, 1000);
    reconnectTimer.unref();
}

async function connect() {
    if (!running || listener) return;
    reconnectTimer = null;
    // LISTEN needs its own session; transaction-mode connection pooling is unsuitable here.
    const client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
    listener = client;
    client.on('error', (error) => reconnect(client, error));
    client.on('end', () => reconnect(client));
    client.on('notification', (notification) => {
        if (notification.channel !== CHANNEL) return;
        try {
            const { eventId } = JSON.parse(notification.payload);
            if (Number.isSafeInteger(eventId) && eventId > 0) broadcast(eventId);
        } catch {
            // Ignore malformed notifications; no visitor data is included in this channel.
        }
    });
    try {
        await client.connect();
        if (listener !== client || !running) return;
        await client.query(`LISTEN ${CHANNEL}`);
        // Refresh active dashboards after reconnecting in case a notification was missed.
        for (const eventId of subscribersByEvent.keys()) broadcast(eventId);
    } catch (error) {
        reconnect(client, error);
    }
}

function start() {
    if (running) return;
    running = true;
    void connect();
}

async function stop() {
    running = false;
    clearTimeout(reconnectTimer);
    reconnectTimer = null;
    const client = listener;
    listener = null;
    if (client) await client.end().catch(() => {});
    subscribersByEvent.clear();
}

// Votes and resets use the database trigger. This is also available for content changes.
async function publishResultsUpdated(eventId) {
    await pool.query('SELECT pg_notify($1, $2)', [CHANNEL, JSON.stringify({ eventId })]);
}

module.exports = { subscribe, removeSocket, publishResultsUpdated, start, stop };
