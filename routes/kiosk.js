'use strict';

const express = require('express');
const { loginLimiter } = require('../middleware/rateLimiter');
const { requireKiosk } = require('../middleware/auth');
const {
  unlockKiosk,
  getKioskStatus,
  listTodayShifts,
  kioskCheckIn,
  kioskCheckOut,
  lockKiosk,
} = require('../controllers/kioskController');

const router = express.Router();

// Unlock does not require an existing kiosk session.
router.post('/unlock', loginLimiter, unlockKiosk);
router.get('/status', getKioskStatus);
router.post('/lock', lockKiosk);

router.get('/shifts/today', requireKiosk, listTodayShifts);
router.post('/applications/:id/check-in', requireKiosk, kioskCheckIn);
router.post('/applications/:id/check-out', requireKiosk, kioskCheckOut);

module.exports = router;
