const express = require('express');
const authenticate = require('../middleware/authenticate');
const votesController = require('../controllers/votes.controller');

const router = express.Router({ mergeParams: true });

router.post('/', authenticate('visitor'), votesController.castVote);

module.exports = router;
