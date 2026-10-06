require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const http = require('node:http');
const app = require('./app');
const { attachWebSocketServer } = require('./services/webSocketServer');

const PORT = process.env.PORT || 3000;
const server = http.createServer(app);

attachWebSocketServer(server);

server.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

module.exports = server;
