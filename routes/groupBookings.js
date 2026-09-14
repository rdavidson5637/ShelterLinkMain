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

const router = express.Router();

// Public request form
router.post('/', groupBookingLimiter, createGroupBooking);

// Admin/staff management
router.get('/', isAuthenticated, requireStaff, listGroupBookings);
router.post('/:id/confirm', isAuthenticated, requireStaff, auditMutations, confirmGroupBooking);
router.post('/:id/decline', isAuthenticated, requireStaff, auditMutations, declineGroupBooking);

module.exports = router;
