const express = require('express');
const controller = require('./results.controller');

const router = express.Router();
router.get('/', controller.getResults);
router.get('/live', controller.streamResults);

module.exports = router;
