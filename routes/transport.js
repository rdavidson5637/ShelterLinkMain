'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  createRun,
  listRuns,
  getRun,
  updateRunStatus,
  listOpenLegs,
  listMyLegs,
  claimLeg,
  completeLeg,
  setExpenseClaimed,
  mileageTotals,
  chaseCover,
} = require('../controllers/transportController');

const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));
router.param('legId', positiveParam('legId'));

router.get('/legs/open', isAuthenticated, listOpenLegs);
router.get('/legs/mine', isAuthenticated, listMyLegs);
router.post('/legs/:legId/claim', isAuthenticated, auditMutations, validateBody(bodies.empty), claimLeg);
router.post('/legs/:legId/complete', isAuthenticated, auditMutations, validateBody(bodies.completeLeg), completeLeg);
router.put(
  '/legs/:legId/expense',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.expense),
  setExpenseClaimed
);

router.get('/mileage', isAuthenticated, requireStaff, validateQuery(queries.transportMileage), mileageTotals);

router.get('/', isAuthenticated, requireStaff, validateQuery(queries.status), listRuns);
router.post('/', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.transportRun), createRun);
router.get('/:id', isAuthenticated, getRun);
router.put('/:id/status', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.transportStatus), updateRunStatus);
router.post('/:id/chase', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.empty), chaseCover);

module.exports = router;
