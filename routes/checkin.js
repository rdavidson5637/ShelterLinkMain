'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const {
  getShiftCheckInStatus,
  qrCheckIn,
  qrCheckOut,
  getCheckInPoster,
  getCheckInPosterQr,
} = require('../controllers/qrCheckinController');
const { validateBody, positiveParam } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

// Volunteer, on their own phone after scanning a shift poster.
router.get('/shifts/:id', isAuthenticated, getShiftCheckInStatus);
router.post('/shifts/:id/check-in', isAuthenticated, validateBody(bodies.checkCode), qrCheckIn);
router.post('/shifts/:id/check-out', isAuthenticated, validateBody(bodies.checkCode), qrCheckOut);

// Staff, printing the poster.
router.get('/poster/:id', isAuthenticated, requireStaff, getCheckInPoster);
router.get('/poster/:id/qr.svg', isAuthenticated, requireStaff, getCheckInPosterQr);

module.exports = router;
