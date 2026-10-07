const express = require('express');
const authenticate = require('../middleware/authenticate');
const visitorSession = require('../controllers/visitorSession.controller');
const authController = require('../controllers/auth.controller');

const router = express.Router();

router.post('/register', authController.register);
router.post('/verify-otp', authController.verifyOtp);

router.get('/me', authenticate('visitor'), visitorSession.me);
module.exports = router;
