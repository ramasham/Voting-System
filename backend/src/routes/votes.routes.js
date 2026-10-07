const express = require('express');
const authenticate = require('../middleware/authenticate');
const { voteRateLimit } = require('../middleware/rateLimit.middleware');
const votesController = require('../controllers/votes.controller');

const router = express.Router({ mergeParams: true });

router.get('/', authenticate('visitor'), votesController.getVotes);

router.post(
    '/',
    authenticate('visitor'),
    voteRateLimit,
    votesController.castVote
);

module.exports = router;
