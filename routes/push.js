'use strict';

const express = require('express');
const { isAuthenticated } = require('../middleware/auth');
const {
  getVapidPublicKey,
  subscribe,
  unsubscribe,
  sendTest,
  updateNotificationPrefs,
  getNotificationPrefs,
} = require('../controllers/pushController');
const { pushTestLimiter } = require('../middleware/rateLimiter');

const { validateBody } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();

router.get('/vapid-public-key', getVapidPublicKey);
router.post('/subscribe', isAuthenticated, validateBody(bodies.subscribe), subscribe);
router.post('/unsubscribe', isAuthenticated, validateBody(bodies.unsubscribe), unsubscribe);
router.post('/test', isAuthenticated, pushTestLimiter, validateBody(bodies.empty), sendTest);
router.get('/prefs', isAuthenticated, getNotificationPrefs);
router.put('/prefs', isAuthenticated, validateBody(bodies.pushPrefs), updateNotificationPrefs);

module.exports = router;
