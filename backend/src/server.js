require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const http = require('node:http');
const app = require('./app');
const { attachWebSocketServer } = require('./services/webSocketServer');

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

const sockets = attachWebSocketServer(server, app);
const pool = require('../db/connection');

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

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

module.exports = server;
