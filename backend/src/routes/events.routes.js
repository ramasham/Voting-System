const express = require('express');
const eventsController = require('../controllers/events.controller');
const authenticate = require('../middleware/authenticate');
const locationController = require('../controllers/location.controller');

const router = express.Router();

router.get('/', eventsController.getEvents);
router.get('/:eventId/config', eventsController.getVotingConfig);
router.get('/:eventId/categories', eventsController.getEventCategories);
router.get('/:eventId/exhibitors', eventsController.getEventExhibitors);
router.get('/:eventId/location', locationController.getLocationStatus);
router.post(
  '/:eventId/location/samples',
  authenticate('visitor'),
  locationController.captureTrustedNetworkSample
);

module.exports = router;
