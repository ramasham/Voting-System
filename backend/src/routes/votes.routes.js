const express = require('express');
const authenticate = require('../middleware/authenticate');
const venueAccess = require('../middleware/venueAccess.middleware');
const votesController = require('../controllers/votes.controller');

const router = express.Router({ mergeParams: true });

router.post('/', authenticate('visitor'), venueAccess, votesController.castVote);

module.exports = router;
