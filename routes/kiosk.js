'use strict';

const express = require('express');
const { loginLimiter, loginAccountLimiter } = require('../middleware/rateLimiter');
const { requireKiosk } = require('../middleware/auth');
const {
  unlockKiosk,
  getKioskStatus,
  listTodayShifts,
  kioskCheckIn,
  kioskCheckOut,
  lockKiosk,
} = require('../controllers/kioskController');

const { validateBody, positiveParam } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

// Unlock does not require an existing kiosk session.
router.post('/unlock', loginAccountLimiter, loginLimiter, validateBody(bodies.kioskUnlock), unlockKiosk);
router.get('/status', getKioskStatus);
router.post('/lock', validateBody(bodies.empty), lockKiosk);

router.get('/shifts/today', requireKiosk, listTodayShifts);
router.post('/applications/:id/check-in', requireKiosk, validateBody(bodies.checkCode), kioskCheckIn);
router.post('/applications/:id/check-out', requireKiosk, validateBody(bodies.checkCode), kioskCheckOut);

module.exports = router;
