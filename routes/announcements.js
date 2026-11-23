'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const { messageLimiter } = require('../middleware/rateLimiter');
const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');
const {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  archiveAnnouncement,
  emailAnnouncement,
} = require('../controllers/announcementController');

const router = express.Router();
router.param('id', positiveParam('id'));

router.get(
  '/',
  isAuthenticated,
  validateQuery(queries.shelterAnnouncements),
  listAnnouncements
);

router.post(
  '/',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.shelterAnnouncementCreate),
  createAnnouncement
);

router.put(
  '/:id',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.shelterAnnouncementUpdate),
  updateAnnouncement
);

router.post(
  '/:id/archive',
  isAuthenticated,
  requireStaff,
  auditMutations,
  archiveAnnouncement
);

router.post(
  '/:id/email',
  isAuthenticated,
  requireStaff,
  messageLimiter,
  auditMutations,
  emailAnnouncement
);

module.exports = router;
