const express = require('express');

const venueAccess = require('./middleware/venueAccess.middleware');
const { voteRateLimit } = require('./middleware/rateLimit.middleware');

const resultsRoutes = require('./modules/results/results.routes');

const eventsRoutes = require('./routes/events.routes');
const authRoutes = require('./routes/auth.routes');
const adminRoutes = require('./routes/admin.routes');
const votesRoutes = require('./routes/votes.routes');

const app = express();

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

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok'
    });
});

app.get('/api/events/:eventId/venue-test', venueAccess, (req, res) => {
    res.status(200).json({
        success: true,
        message: 'You are inside the allowed network'
    });
});

if (process.env.NODE_ENV !== 'production') {
    app.get('/rate-limit-test', voteRateLimit, (req, res) => {
        res.status(200).json({
            success: true,
            message: 'Request allowed'
        });
    });
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