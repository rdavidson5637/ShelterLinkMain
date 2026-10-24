'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  listIncidents,
  getIncident,
  createIncident,
  updateIncident,
  resolveIncident,
  deleteIncident,
} = require('../controllers/incidentController');

const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

// Staff/admin only — volunteers get 403 from requireStaff
router.get('/', isAuthenticated, requireStaff, validateQuery(queries.incidents), listIncidents);
router.post('/', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.incident), createIncident);
router.get('/:id', isAuthenticated, requireStaff, getIncident);
router.put('/:id', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.incident), updateIncident);
router.post('/:id/resolve', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.empty), resolveIncident);
router.delete('/:id', isAuthenticated, requireStaff, auditMutations, deleteIncident);

module.exports = router;
