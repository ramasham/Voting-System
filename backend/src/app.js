const express = require('express');
const venueAccess = require('./middleware/venueAccess.middleware');

const app = express();

app.use(express.json());

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

module.exports = app;   