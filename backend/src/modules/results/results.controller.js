const resultsService = require('./results.service');

async function getResults(req, res, next) {
    try {
        return res.status(200).json({ success: true, data: await resultsService.getResults() });
    } catch (error) {
        return next(error);
    }
}

module.exports = { getResults };
