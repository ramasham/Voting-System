const express = require('express');

const venueAccess = require('./middleware/venueAccess.middleware');
const { voteRateLimit } = require('./middleware/rateLimit.middleware');

const resultsRoutes = require('./modules/results/results.routes');

const eventsRoutes = require('./routes/events.routes');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const votesRoutes = require('./routes/votes.routes');

const app = express();
const pool = require('../db/connection');
const { getExhibitorPhoto } = require('./controllers/media.controller');
const corsOrigins = new Set(
    (process.env.CORS_ORIGINS || '')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
);

app.disable('x-powered-by');
app.use((req, res, next) => {
    res.set('X-Content-Type-Options', 'nosniff');
    res.set('Cache-Control', 'no-store');
    const revision = process.env.RENDER_GIT_COMMIT;
    if (/^[a-f0-9]{40}$/i.test(revision || '')) res.set('X-App-Revision', revision);
    const origin = req.get('Origin');
    if (origin) res.vary('Origin');
    if (origin && corsOrigins.has(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
        res.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.set('Access-Control-Max-Age', '600');
    }
    if (req.method === 'OPTIONS') return res.sendStatus(204);
    next();
});

const trustProxy = process.env.TRUST_PROXY;

if (trustProxy === 'true') {
    app.set('trust proxy', 1);
} else if (trustProxy && /^\d+$/.test(trustProxy)) {
    app.set('trust proxy', Number(trustProxy));
} else if (trustProxy && trustProxy !== 'false') {
    app.set(
        'trust proxy',
        trustProxy.split(',').map((entry) => entry.trim())
    );
}

app.use(express.json({ limit: '32kb' }));

app.use('/api/auth', authRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/events/:eventId/votes', votesRoutes);
app.use('/api/admin', adminRoutes);

app.use('/api/results', resultsRoutes);
app.get('/api/media/exhibitors/:exhibitorId/photo', getExhibitorPhoto);

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok'
    });
});

app.get('/ready', async (req, res) => {
    try {
        await pool.query('SELECT 1');
        res.status(200).json({ status: 'ready' });
    } catch {
        res.status(503).json({ status: 'unavailable' });
    }
});

app.get('/api/events/:eventId/venue-test', venueAccess, (req, res) => {
    res.status(200).json({
        success: true,
        message: 'You are inside the allowed network'
    });
});
app.post('/api/events/:eventId/venue-test', venueAccess, (req, res) => {
    res.json({ success: true });
});

if (process.env.NODE_ENV !== 'production') {
    app.get('/rate-limit-test', voteRateLimit, (req, res) => {
        res.status(200).json({
            success: true,
            message: 'Request allowed'
        });
    });
}

app.use('/api', (req, res) => {
    res.status(404).json({ success: false, code: 'NOT_FOUND', message: 'API route not found' });
});

if (process.env.NODE_ENV === 'production' || process.env.SERVE_FRONTEND === 'true') {
    const path = require('node:path');
    const { serveFrontend } = require('./services/serveFrontend');
    serveFrontend(app, path.resolve(__dirname, '../../frontend/dvs/dist'));
}

app.use((error, req, res, next) => {
    if (res.headersSent) {
        return next(error);
    }

    const status =
        Number.isInteger(error.status) &&
        error.status >= 400 &&
        error.status < 500
            ? error.status
            : 500;

    if (status >= 500) {
        console.error('Unhandled request error:', error.message);
    }

    return res.status(status).json({
        success: false,
        message:
            status === 400
                ? 'Invalid request body'
                : 'Request could not be processed'
    });
});

module.exports = app;
