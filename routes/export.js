const express = require('express');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  exportVolunteers,
  exportHours,
  exportVolunteerOwnHours,
  exportCommunityService,
} = require('../controllers/exportController');

const { validateQuery } = require('../middleware/validate');
const { queries } = require('../validation/bodies');

const router = express.Router();

router.get('/volunteers', isAuthenticated, requireRole('admin'), auditMutations, exportVolunteers);
router.get('/hours', isAuthenticated, requireRole('admin'), auditMutations, validateQuery(queries.exportRange), exportHours);
router.get(
  '/community-service',
  isAuthenticated,
  requireRole('admin'),
  auditMutations,
  exportCommunityService
);
router.get('/my-hours', isAuthenticated, validateQuery(queries.exportOwn), exportVolunteerOwnHours);

module.exports = router;
