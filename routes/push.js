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

const router = express.Router();

router.get('/vapid-public-key', getVapidPublicKey);
router.post('/subscribe', isAuthenticated, subscribe);
router.post('/unsubscribe', isAuthenticated, unsubscribe);
router.post('/test', isAuthenticated, pushTestLimiter, sendTest);
router.get('/prefs', isAuthenticated, getNotificationPrefs);
router.put('/prefs', isAuthenticated, updateNotificationPrefs);

module.exports = router;
