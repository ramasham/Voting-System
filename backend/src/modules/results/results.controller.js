const resultsService = require('./results.service');
const { parsePositiveInteger } = require('../../utils/validation');

async function getResults(req, res, next) {
    try {
        const eventId = parsePositiveInteger(req.params.eventId || req.query.eventId);
        if (!eventId) {
            return res.status(400).json({ success: false, code: 'INVALID_EVENT_ID', message: 'A valid eventId is required' });
        }
        const data = await resultsService.getResults(eventId);
        if (!data) return res.status(404).json({ success: false, message: 'Event not found' });
        res.set('Cache-Control', 'no-store');
        return res.status(200).json({ success: true, data });
    } catch (error) {
        return next(error);
    }
}

module.exports = { getResults };
