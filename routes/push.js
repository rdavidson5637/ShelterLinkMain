'use strict';

const express = require('express');
const { isAuthenticated } = require('../middleware/auth');
const {
  getVapidPublicKey,
  subscribe,
  unsubscribe,
  updateNotificationPrefs,
  getNotificationPrefs,
} = require('../controllers/pushController');

const router = express.Router();

router.get('/vapid-public-key', getVapidPublicKey);
router.post('/subscribe', isAuthenticated, subscribe);
router.post('/unsubscribe', isAuthenticated, unsubscribe);
router.get('/prefs', isAuthenticated, getNotificationPrefs);
router.put('/prefs', isAuthenticated, updateNotificationPrefs);

module.exports = router;
