const express = require('express');
const venueAccess = require('./middleware/venueAccess.middleware');
const { voteRateLimit } = require('./middleware/rateLimit.middleware');
const resultsRoutes = require('./modules/results/results.routes');

const app = express();

app.use(express.json());

app.use('/api/results', resultsRoutes);

app.get('/health', (req, res) => {
    res.status(200).json({
        status: 'ok'
    });
});

app.get('/venue-test', venueAccess, (req, res) => {
    res.status(200).json({
        success: true,
        message: 'You are inside the allowed network'
    });
});

app.get('/rate-limit-test', voteRateLimit, (req, res) => {
    res.status(200).json({
        success: true,
        message: 'Request allowed'
    });
});

module.exports = app;