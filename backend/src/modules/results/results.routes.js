const express = require('express');
const controller = require('./results.controller');
const authenticate = require('../../middleware/authenticate');
const adminApiRateLimit = require('../../middleware/adminApiRateLimit');

const router = express.Router();
router.use(authenticate('admin'), adminApiRateLimit);
router.get('/', controller.getResults);
router.get('/:eventId', controller.getResults);

module.exports = router;
