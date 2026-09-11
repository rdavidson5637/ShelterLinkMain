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

const router = express.Router();

router.get('/legs/open', isAuthenticated, listOpenLegs);
router.get('/legs/mine', isAuthenticated, listMyLegs);
router.post('/legs/:legId/claim', isAuthenticated, auditMutations, claimLeg);
router.post('/legs/:legId/complete', isAuthenticated, auditMutations, completeLeg);
router.put(
  '/legs/:legId/expense',
  isAuthenticated,
  requireStaff,
  auditMutations,
  setExpenseClaimed
);

router.get('/mileage', isAuthenticated, requireStaff, mileageTotals);

router.get('/', isAuthenticated, requireStaff, listRuns);
router.post('/', isAuthenticated, requireStaff, auditMutations, createRun);
router.get('/:id', isAuthenticated, getRun);
router.put('/:id/status', isAuthenticated, requireStaff, auditMutations, updateRunStatus);
router.post('/:id/chase', isAuthenticated, requireStaff, auditMutations, chaseCover);

module.exports = router;
