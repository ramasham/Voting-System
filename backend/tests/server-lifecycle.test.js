const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { execFile } = require('node:child_process');

test('an occupied port produces a recovery hint, exits cleanly, and leaves the existing listener running', async (t) => {
    const existing = http.createServer((req, res) => res.end('existing server'));
    await new Promise(resolve => existing.listen(0, resolve));
    t.after(() => new Promise(resolve => existing.close(resolve)));
    const port = existing.address().port;

    // Exercise real HTTP/WebSocket startup without opening any database connection.
    const bootstrap = `
        const connection = require.resolve('./db/connection');
        require.cache[connection] = {
            id: connection, filename: connection, loaded: true,
            exports: { end: async () => {} }
        };
        const notifier = require('./src/services/resultsNotifier');
        notifier.start = () => {};
        notifier.stop = async () => {};
        require('./src/server');
    `;
    const result = await new Promise(resolve => {
        execFile(process.execPath, ['-e', bootstrap], {
            cwd: path.resolve(__dirname, '..'),
            env: { ...process.env, PORT: String(port), NODE_ENV: 'test' },
            timeout: 5000,
        }, (error, stdout, stderr) => resolve({ error, stdout, stderr }));
    });

    assert.equal(result.error?.code, 1, result.stderr);
    assert.match(result.stderr, new RegExp(`port ${port} is already in use`));
    assert.match(result.stderr, /Ctrl\+C.*Ctrl\+Z.*fg/);
    assert.doesNotMatch(result.stderr, /Unhandled|node:events|at Server/);
    assert.equal(existing.listening, true);
    const response = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(2000) });
    assert.equal(await response.text(), 'existing server');
});
