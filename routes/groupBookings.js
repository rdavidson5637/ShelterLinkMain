'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const { groupBookingLimiter } = require('../middleware/rateLimiter');
const {
  createGroupBooking,
  listGroupBookings,
  confirmGroupBooking,
  declineGroupBooking,
} = require('../controllers/groupBookingController');

const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

// Public request form
router.post('/', groupBookingLimiter, validateBody(bodies.groupBooking), createGroupBooking);

// Admin/staff management
router.get('/', isAuthenticated, requireStaff, validateQuery(queries.status), listGroupBookings);
router.post('/:id/confirm', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.empty), confirmGroupBooking);
router.post('/:id/decline', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.empty), declineGroupBooking);

module.exports = router;
