'use strict';

/**
 * /api/platform: platform owner routes (self-serve brief section 9 item 5).
 * isPlatformOwner runs before anything else, including param validation,
 * so a non-owner gets the same 404 as an unknown API path on every route.
 */

const express = require('express');
const { isPlatformOwner } = require('../middleware/platformOwner');
const { positiveParam } = require('../middleware/validate');
const {
  listApplications,
  approveApplication,
  rejectApplication,
  listShelters,
  suspendShelter,
  reactivateShelter,
} = require('../controllers/platformController');

const router = express.Router();

router.use(isPlatformOwner);
router.param('id', positiveParam('id'));

router.get('/applications', listApplications);
router.post('/applications/:id/approve', approveApplication);
router.post('/applications/:id/reject', rejectApplication);
router.get('/shelters', listShelters);
router.post('/shelters/:id/suspend', suspendShelter);
router.post('/shelters/:id/reactivate', reactivateShelter);

// Unknown paths under /api/platform 404 here, after the owner check.
router.use((req, res, next) => next({ type: 'not_found', message: 'API endpoint not found' }));

module.exports = router;
