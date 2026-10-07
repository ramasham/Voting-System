const WebSocket = require('ws');
const { verifyToken } = require('./tokens');
const { castVote, VoteError } = require('./vote.service');
const { voteRateLimit } = require('../middleware/rateLimit.middleware');
const { parsePositiveInteger } = require('../utils/validation');
const resultsNotifier = require('./resultsNotifier');
const pool = require('../../db/connection');
const proxyaddr = require('proxy-addr');
const { recordAuditEvent } = require('./auditLog.service');

let webSocketServer;

function send(socket, message) {
    if (socket.readyState === WebSocket.OPEN) {
        if (socket.bufferedAmount > 64 * 1024) {
            socket.terminate();
            return;
        }
        try {
            socket.send(JSON.stringify(message));
        } catch (error) {
            if (process.env.NODE_ENV !== 'production') {
                console.info(`[websocket] send failed: ${error.message}`);
            }
        }
    }
}

function authenticate(token) {
    if (typeof token !== 'string' || token.length === 0) return null;
    for (const role of ['visitor', 'admin']) {
        try {
            return verifyToken(token, role);
        } catch {
            // Try the other supported token role before rejecting it.
        }
    }
    return null;
}

async function handleMessage(socket, clientIp, message) {
    if (message.type === 'AUTH') {
        // A new identity must not inherit the previous identity's subscriptions.
        resultsNotifier.removeSocket(socket);
        clearTimeout(socket.authTimer);
        socket.auth = null;
        const auth = authenticate(message.token);
        if (!auth) {
            send(socket, { type: 'AUTH_ERROR', code: 'INVALID_TOKEN' });
            socket.close(1008, 'Invalid access token');
            return;
        }
        socket.auth = auth;
        socket.authTimer = setTimeout(() => {
            resultsNotifier.removeSocket(socket);
            socket.auth = null;
            send(socket, { type: 'AUTH_ERROR', code: 'TOKEN_EXPIRED' });
            socket.close(1008, 'Access token expired');
        }, Math.min(auth.expiresAt * 1000 - Date.now(), 2147483647));
        socket.authTimer.unref();
        send(socket, { type: 'AUTH_SUCCESS' });
        return;
    }

    if (!socket.auth || socket.auth.expiresAt <= Date.now() / 1000) {
        resultsNotifier.removeSocket(socket);
        socket.auth = null;
        send(socket, {
            type: message.type === 'CAST_VOTE' ? 'VOTE_REJECTED' : 'ERROR',
            code: 'AUTHENTICATION_REQUIRED'
        });
        return;
    }

    if (message.type === 'SUBSCRIBE_RESULTS') {
        if (socket.auth.role !== 'admin') {
            send(socket, { type: 'ERROR', code: 'ADMIN_AUTH_REQUIRED' });
            return;
        }
        const eventId = parsePositiveInteger(message.eventId);
        if (!eventId) {
            send(socket, { type: 'ERROR', code: 'INVALID_EVENT_ID' });
            return;
        }
        const event = await pool.query('SELECT id FROM events WHERE id = $1', [eventId]);
        if (event.rowCount === 0) {
            send(socket, { type: 'ERROR', code: 'EVENT_NOT_FOUND' });
            return;
        }
        // The auth timer can expire while the event lookup is in flight.
        if (socket.auth?.role !== 'admin' || socket.auth.expiresAt <= Date.now() / 1000) return;
        resultsNotifier.subscribe(socket, eventId);
        send(socket, { type: 'RESULTS_SUBSCRIBED', eventId });
        send(socket, { type: 'RESULTS_UPDATED', eventId, timestamp: new Date().toISOString() });
        return;
    }

    if (message.type === 'CAST_VOTE') {
        if (socket.auth.role !== 'visitor') {
            send(socket, { type: 'VOTE_REJECTED', code: 'VISITOR_AUTH_REQUIRED' });
            return;
        }

        const visitorId = socket.auth.id;
        const limit = await voteRateLimit.consume(`visitor:${visitorId}`);
        if (!limit.allowed) {
            send(socket, { type: 'VOTE_REJECTED', code: 'RATE_LIMITED' });
            return;
        }

        try {
            const vote = await castVote({
                eventId: message.eventId,
                categoryId: message.categoryId,
                exhibitorId: message.exhibitorId,
                visitorId,
                clientIp,
                coordinates: message.location,
            });

            if (!vote.replayed) {
                await recordAuditEvent('VOTE_SUCCESS', {
                    eventId: vote.event_id,
                    categoryId: vote.category_id,
                    exhibitorId: vote.exhibitor_id,
                });
            }

            // The vote service returns only after PostgreSQL COMMIT succeeds.
            send(socket, {
                type: 'VOTE_ACCEPTED',
                eventId: vote.event_id,
                categoryId: vote.category_id,
                exhibitorId: vote.exhibitor_id,
                replayed: vote.replayed,
            });
        } catch (error) {
            await recordAuditEvent('VOTE_REJECTED', {
                eventId: message.eventId,
                categoryId: message.categoryId,
                exhibitorId: message.exhibitorId,
                reason: error instanceof VoteError ? error.code : 'VOTE_FAILED',
            });
            if (error instanceof VoteError) {
                send(socket, { type: 'VOTE_REJECTED', code: error.code });
            } else {
                console.error('WebSocket vote failed:', error.message);
                send(socket, { type: 'VOTE_REJECTED', code: 'VOTE_FAILED' });
            }
        }
        return;
    }

    send(socket, { type: 'ERROR', code: 'UNKNOWN_MESSAGE_TYPE' });
}

function attachWebSocketServer(server, app) {
    if (webSocketServer) return webSocketServer;

    webSocketServer = new WebSocket.WebSocketServer({
        server,
        path: '/ws',
        maxPayload: 16 * 1024
    });
    resultsNotifier.start();
    webSocketServer.on('connection', (socket, request) => {
        socket.isAlive = true;
        socket.auth = null;
        socket.resultSubscriptions = new Set();
        socket.messageQueue = Promise.resolve();
        socket.pendingMessages = 0;
        // Match Express's explicitly configured trusted proxy rules for HTTP voting.
        const clientIp = app
            ? proxyaddr(request, app.get('trust proxy fn'))
            : request.socket.remoteAddress;
        socket.authTimer = setTimeout(() => socket.close(1008, 'Authentication required'), 10000);
        socket.authTimer.unref();

        socket.on('pong', () => { socket.isAlive = true; });
        socket.on('message', (data, isBinary) => {
            if (isBinary) {
                send(socket, { type: 'ERROR', code: 'INVALID_MESSAGE_FORMAT' });
                return;
            }

            let message;
            try {
                message = JSON.parse(data.toString());
                if (!message || typeof message !== 'object' || Array.isArray(message)) {
                    throw new Error('Message must be a JSON object');
                }
            } catch {
                send(socket, { type: 'ERROR', code: 'INVALID_JSON' });
                return;
            }

            if (socket.pendingMessages >= 32) {
                send(socket, { type: 'ERROR', code: 'RATE_LIMITED' });
                return;
            }
            socket.pendingMessages += 1;
            socket.messageQueue = socket.messageQueue.then(async () => {
                if (socket.readyState === WebSocket.OPEN) await handleMessage(socket, clientIp, message);
            }).catch((error) => {
                console.error('WebSocket message failed:', error.message);
                send(socket, { type: 'ERROR', code: 'REQUEST_FAILED' });
            }).finally(() => { socket.pendingMessages -= 1; });
        });
        socket.on('close', () => {
            clearTimeout(socket.authTimer);
            resultsNotifier.removeSocket(socket);
        });
        socket.on('error', (error) => {
            if (process.env.NODE_ENV !== 'production') {
                console.info(`[websocket] client error: ${error.message}`);
            }
        });
    });

    const heartbeat = setInterval(() => {
        for (const socket of webSocketServer.clients) {
            if (!socket.isAlive) {
                socket.terminate();
                continue;
            }
            socket.isAlive = false;
            socket.ping();
        }
    }, 30000);
    heartbeat.unref();

    webSocketServer.on('close', () => {
        clearInterval(heartbeat);
        webSocketServer = undefined;
        void resultsNotifier.stop();
    });
    return webSocketServer;
}

module.exports = { attachWebSocketServer };
