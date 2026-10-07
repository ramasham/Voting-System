require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const http = require('node:http');
const app = require('./app');
const { attachWebSocketServer } = require('./services/webSocketServer');
const { checkSmsOnStartup } = require('./services/smsDiagnostics');

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const sockets = attachWebSocketServer(server, app);
const pool = require('../db/connection');

let stopping = false;
async function shutdown() {
    if (stopping) return;
    stopping = true;
    const deadline = setTimeout(() => process.exit(1), 10000);
    deadline.unref();
    for (const socket of sockets.clients) socket.close(1001, 'Server restarting');
    sockets.close();
    server.close(async () => {
        const notifier = require('./services/resultsNotifier');
        if (notifier.stop) await notifier.stop();
        await pool.end();
        clearTimeout(deadline);
    });
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

function handleServerError(error) {
    if (stopping) return;
    process.exitCode = 1;
    if (error.code === 'EADDRINUSE') {
        console.error(`Cannot start backend: port ${PORT} is already in use. Stop the existing backend with Ctrl+C. If it was paused with Ctrl+Z, run fg in its terminal, then Ctrl+C.`);
    } else {
        console.error('Backend server failed:', error.code || 'SERVER_ERROR');
    }
    void shutdown();
}

// ws forwards HTTP server errors, so both emitters need a handler.
server.on('error', handleServerError);
sockets.on('error', handleServerError);
server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
    void checkSmsOnStartup();
});

module.exports = server;
