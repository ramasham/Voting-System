const express = require('express');
const authenticate = require('../middleware/authenticate');
const adminApiRateLimit = require('../middleware/adminApiRateLimit');
const adminAuthController = require('../controllers/adminAuth.controller');
const adminContentController = require('../controllers/adminContent.controller');
const adminEventsController = require('../controllers/adminEvents.controller');

const router = express.Router();

router.post('/login', adminAuthController.login);

router.use(authenticate('admin'), adminApiRateLimit);

router.get('/events/:eventId/settings', adminEventsController.getSettings);
router.patch('/events/:eventId/settings', adminEventsController.updateSettings);
router.post('/events/:eventId/voting/open', adminEventsController.openVoting);
router.post('/events/:eventId/voting/close', adminEventsController.closeVoting);

router.get('/events/:eventId/categories', adminContentController.getCategories);
router.post('/events/:eventId/categories', adminContentController.createCategory);
router.patch('/events/:eventId/categories/:categoryId', adminContentController.updateCategory);
router.delete('/events/:eventId/categories/:categoryId', adminContentController.deleteCategory);

router.get('/events/:eventId/exhibitors', adminContentController.getExhibitors);
router.post('/events/:eventId/exhibitors', adminContentController.createExhibitor);
router.patch('/events/:eventId/exhibitors/:exhibitorId', adminContentController.updateExhibitor);
router.delete('/events/:eventId/exhibitors/:exhibitorId', adminContentController.deleteExhibitor);

router.get('/events/:eventId/results', adminEventsController.getResults);
router.get('/events/:eventId/export.csv', adminEventsController.exportResults);

module.exports = router;
