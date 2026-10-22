'use strict';

const express = require('express');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  listCustomFields,
  listActiveProfileFields,
  createCustomField,
  updateCustomField,
  deactivateCustomField,
  deleteCustomField,
  reorderCustomFields,
} = require('../controllers/customFieldController');

const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

router.get('/', isAuthenticated, validateQuery(queries.customFields), listCustomFields);
router.get('/active', isAuthenticated, listActiveProfileFields);
router.post('/', isAuthenticated, requireRole('admin'), auditMutations, validateBody(bodies.customField), createCustomField);
router.put('/reorder', isAuthenticated, requireRole('admin'), auditMutations, validateBody(bodies.reorderFields), reorderCustomFields);
router.put('/:id', isAuthenticated, requireRole('admin'), auditMutations, validateBody(bodies.customField), updateCustomField);
router.post('/:id/deactivate', isAuthenticated, requireRole('admin'), auditMutations, validateBody(bodies.empty), deactivateCustomField);
router.delete('/:id', isAuthenticated, requireRole('admin'), auditMutations, deleteCustomField);

module.exports = router;
