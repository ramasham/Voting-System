const express = require('express');
const eventsController = require('../controllers/events.controller');

const router = express.Router();

router.get('/', eventsController.getEvents);
router.get('/:eventId/categories', eventsController.getEventCategories);
router.get('/:eventId/exhibitors', eventsController.getEventExhibitors);

module.exports = router;
