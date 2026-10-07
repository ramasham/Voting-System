const express = require('express');
const authenticate = require('../middleware/authenticate');
const venueAccess = require('../middleware/venueAccess.middleware');
const { voteRateLimit } = require('../middleware/rateLimit.middleware');
const votesController = require('../controllers/votes.controller');

const router = express.Router({ mergeParams: true });

router.post(
    '/',
    authenticate('visitor'),
    venueAccess,
    voteRateLimit,
    votesController.castVote
);

module.exports = router;
