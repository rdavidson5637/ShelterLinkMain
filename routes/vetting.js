'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  requestReference,
  listVolunteerReferences,
  listMyReferences,
  listBackgroundChecks,
  listMyBackgroundChecks,
  listExpiringChecks,
  upsertBackgroundCheck,
  getOnboardingChecklist,
  getOnboardingPipeline,
} = require('../controllers/vettingController');

const { validateBody, positiveParam } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();
router.param('userId', positiveParam('userId'));
router.param('id', positiveParam('id'));

router.use(auditMutations);

// Volunteer self-service (no referee comments)
router.get('/me/references', isAuthenticated, listMyReferences);
router.get('/me/background-checks', isAuthenticated, listMyBackgroundChecks);
router.get('/me/onboarding', isAuthenticated, getOnboardingChecklist);

// Staff / admin
router.get('/admin/pipeline', isAuthenticated, requireStaff, getOnboardingPipeline);
router.get('/admin/expiring', isAuthenticated, requireStaff, listExpiringChecks);
router.get('/volunteers/:userId/references', isAuthenticated, requireStaff, listVolunteerReferences);
router.post('/volunteers/:userId/references', isAuthenticated, requireStaff, validateBody(bodies.referenceRequest), requestReference);
router.get(
  '/volunteers/:userId/background-checks',
  isAuthenticated,
  requireStaff,
  listBackgroundChecks
);
router.post(
  '/volunteers/:userId/background-checks',
  isAuthenticated,
  requireStaff,
  validateBody(bodies.backgroundCheck),
  upsertBackgroundCheck
);
router.put(
  '/volunteers/:userId/background-checks/:id',
  isAuthenticated,
  requireStaff,
  validateBody(bodies.backgroundCheck),
  (req, res, next) => {
    req.body = { ...(req.body || {}), id: req.params.id };
    return upsertBackgroundCheck(req, res, next);
  }
);

module.exports = router;
