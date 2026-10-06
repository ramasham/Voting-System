const WebSocket = require('ws');
const { verifyToken } = require('./tokens');
const { castVote, VoteError } = require('./vote.service');
const { voteRateLimit } = require('../middleware/rateLimit.middleware');
const { parsePositiveInteger } = require('../utils/validation');
const resultsNotifier = require('./resultsNotifier');

let webSocketServer;

function send(socket, message) {
    if (socket.readyState === WebSocket.OPEN) {
        try {
            socket.send(JSON.stringify(message));
        } catch (error) {
            if (process.env.NODE_ENV !== 'production') {
                console.info(`[websocket] send failed: ${error.message}`);
            }
        }
    }
}

function authenticate(socket, token) {
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
    if (!socket.auth) {
        if (message.type === 'AUTH') {
            const auth = authenticate(socket, message.token);
            if (!auth) {
                send(socket, { type: 'AUTH_ERROR', code: 'INVALID_TOKEN' });
                return;
            }
            socket.auth = auth;
            send(socket, { type: 'AUTH_SUCCESS' });
            return;
        }

        if (message.type === 'CAST_VOTE') {
            send(socket, {
                type: 'VOTE_REJECTED',
                code: 'AUTHENTICATION_REQUIRED'
            });
        } else {
            send(socket, {
                type: 'ERROR',
                code: 'AUTHENTICATION_REQUIRED'
            });
        }
        return;
    }

    if (message.type === 'AUTH') {
        const auth = authenticate(socket, message.token);
        if (!auth) {
            send(socket, { type: 'AUTH_ERROR', code: 'INVALID_TOKEN' });
            return;
        }
        socket.auth = auth;
        send(socket, { type: 'AUTH_SUCCESS' });
        return;
    }

    if (message.type === 'SUBSCRIBE_RESULTS') {
        const eventId = parsePositiveInteger(message.eventId);
        if (!eventId) {
            send(socket, { type: 'ERROR', code: 'INVALID_EVENT_ID' });
            return;
        }
        resultsNotifier.subscribe(socket, eventId);
        send(socket, { type: 'RESULTS_SUBSCRIBED', eventId });
        return;
    }

    if (message.type === 'CAST_VOTE') {
        if (socket.auth.role !== 'visitor') {
            send(socket, { type: 'VOTE_REJECTED', code: 'VISITOR_AUTH_REQUIRED' });
            return;
        }

        const limit = voteRateLimit.consume(clientIp || 'unknown');
        if (!limit.allowed) {
            send(socket, { type: 'VOTE_REJECTED', code: 'RATE_LIMITED' });
            return;
        }

        try {
            const vote = await castVote({
                eventId: message.eventId,
                categoryId: message.categoryId,
                exhibitorId: message.exhibitorId,
                visitorId: socket.auth.id,
                clientIp
            });

            // The vote service returns only after PostgreSQL COMMIT succeeds.
            send(socket, {
                type: 'VOTE_ACCEPTED',
                eventId: vote.event_id,
                categoryId: vote.category_id,
                exhibitorId: vote.exhibitor_id
            });
            resultsNotifier.publishResultsUpdated(vote.event_id);
        } catch (error) {
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

function attachWebSocketServer(server) {
    if (webSocketServer) return webSocketServer;

    webSocketServer = new WebSocket.WebSocketServer({
        server,
        path: '/ws',
        maxPayload: 16 * 1024
    });
    webSocketServer.on('connection', (socket, request) => {
        socket.isAlive = true;
        socket.auth = null;
        socket.resultSubscriptions = new Set();
        // Use the TCP peer from the upgrade request; never accept a client-supplied IP.
        const clientIp = request.socket.remoteAddress;

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

            handleMessage(socket, clientIp, message).catch((error) => {
                console.error('WebSocket message failed:', error.message);
                send(socket, { type: 'ERROR', code: 'REQUEST_FAILED' });
            });
        });
        socket.on('close', () => resultsNotifier.removeSocket(socket));
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

    webSocketServer.on('close', () => clearInterval(heartbeat));
    return webSocketServer;
}

module.exports = { attachWebSocketServer };
