const clients = new Set();

function subscribe(writeEvent) {
    clients.add(writeEvent);
    return () => clients.delete(writeEvent);
}

/** Notify connected dashboards after a successful vote/result refresh. */
function publishResultsUpdate(payload) {
    for (const writeEvent of clients) writeEvent(payload);
}

module.exports = { subscribe, publishResultsUpdate };
