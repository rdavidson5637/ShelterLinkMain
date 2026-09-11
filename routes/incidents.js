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

const router = express.Router();

// Staff/admin only — volunteers get 403 from requireStaff
router.get('/', isAuthenticated, requireStaff, listIncidents);
router.post('/', isAuthenticated, requireStaff, auditMutations, createIncident);
router.get('/:id', isAuthenticated, requireStaff, getIncident);
router.put('/:id', isAuthenticated, requireStaff, auditMutations, updateIncident);
router.post('/:id/resolve', isAuthenticated, requireStaff, auditMutations, resolveIncident);
router.delete('/:id', isAuthenticated, requireStaff, auditMutations, deleteIncident);

module.exports = router;
