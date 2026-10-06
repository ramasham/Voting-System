const subscribersByEvent = new Map();

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

function publishResultsUpdated(eventId) {
    const subscribers = subscribersByEvent.get(eventId);
    if (!subscribers) return;

    const message = JSON.stringify({
        type: 'RESULTS_UPDATED',
        eventId,
        timestamp: new Date().toISOString()
    });

    for (const socket of subscribers) {
        if (socket.readyState !== 1) {
            removeSocket(socket);
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

// A multi-instance deployment will need shared pub/sub such as Redis.
module.exports = { subscribe, removeSocket, publishResultsUpdated };
