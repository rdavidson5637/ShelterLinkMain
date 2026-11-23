'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const { messageLimiter } = require('../middleware/rateLimiter');
const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');
const {
  listEvents,
  createEvent,
  updateEvent,
  archiveEvent,
  listAttendees,
  emailAttendees,
  signUp,
  cancelSignup,
} = require('../controllers/eventController');

const router = express.Router();
router.param('id', positiveParam('id'));

router.get(
  '/',
  isAuthenticated,
  validateQuery(queries.shelterEvents),
  listEvents
);

router.post(
  '/',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.shelterEventCreate),
  createEvent
);

router.put(
  '/:id',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.shelterEventUpdate),
  updateEvent
);

router.post(
  '/:id/archive',
  isAuthenticated,
  requireStaff,
  auditMutations,
  archiveEvent
);

router.get(
  '/:id/attendees',
  isAuthenticated,
  requireStaff,
  listAttendees
);

router.post(
  '/:id/email',
  isAuthenticated,
  requireStaff,
  messageLimiter,
  auditMutations,
  emailAttendees
);

router.post(
  '/:id/signup',
  isAuthenticated,
  auditMutations,
  signUp
);

router.post(
  '/:id/cancel',
  isAuthenticated,
  auditMutations,
  cancelSignup
);

module.exports = router;
