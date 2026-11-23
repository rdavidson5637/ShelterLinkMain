'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  createClaim,
  getMyClaims,
  getPending,
  getTotals,
  approveClaim,
  rejectClaim,
} = require('../controllers/mileageController');
const { validateBody, positiveParam } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

router.post('/', isAuthenticated, auditMutations, validateBody(bodies.mileageClaim), createClaim);
router.get('/mine', isAuthenticated, getMyClaims);
router.get('/pending', isAuthenticated, requireStaff, getPending);
router.get('/totals', isAuthenticated, requireStaff, getTotals);
router.put(
  '/:id/approve',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.empty),
  approveClaim
);
router.put(
  '/:id/reject',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.empty),
  rejectClaim
);

module.exports = router;
