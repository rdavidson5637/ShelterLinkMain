'use strict';

const express = require('express');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  listModules,
  getModule,
  createModule,
  updateModule,
  deleteModule,
  submitAttempt,
  myAttempts,
} = require('../controllers/trainingController');
const { validateBody, positiveParam } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

router.get('/', isAuthenticated, listModules);
router.get('/mine/attempts', isAuthenticated, myAttempts);
router.get('/:id', isAuthenticated, getModule);
router.post(
  '/',
  isAuthenticated,
  requireRole('admin'),
  auditMutations,
  validateBody(bodies.trainingModule),
  createModule
);
router.put(
  '/:id',
  isAuthenticated,
  requireRole('admin'),
  auditMutations,
  validateBody(bodies.trainingModule),
  updateModule
);
router.delete('/:id', isAuthenticated, requireRole('admin'), auditMutations, deleteModule);
router.post(
  '/:id/attempts',
  isAuthenticated,
  validateBody(bodies.trainingAttempt),
  submitAttempt
);

module.exports = router;
