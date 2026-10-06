const resultsService = require('./results.service');
const { subscribe } = require('./results.sse');

async function getResults(req, res, next) {
    try {
        return res.status(200).json({ success: true, data: await resultsService.getResults() });
    } catch (error) {
        return next(error);
    }
}

function streamResults(req, res) {
    res.status(200);
    res.set({
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache, no-transform',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no'
    });
    if (typeof res.flushHeaders === 'function') res.flushHeaders();
    res.write('retry: 5000\n\n');

    const unsubscribe = subscribe((event) => {
        res.write(`event: results\ndata: ${JSON.stringify(event)}\n\n`);
    });
    const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 25000);
    req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
    });
}

module.exports = { getResults, streamResults };
