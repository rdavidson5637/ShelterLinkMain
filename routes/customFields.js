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

const router = express.Router();

router.get('/', isAuthenticated, listCustomFields);
router.get('/active', isAuthenticated, listActiveProfileFields);
router.post('/', isAuthenticated, requireRole('admin'), auditMutations, createCustomField);
router.put('/reorder', isAuthenticated, requireRole('admin'), auditMutations, reorderCustomFields);
router.put('/:id', isAuthenticated, requireRole('admin'), auditMutations, updateCustomField);
router.post('/:id/deactivate', isAuthenticated, requireRole('admin'), auditMutations, deactivateCustomField);
router.delete('/:id', isAuthenticated, requireRole('admin'), auditMutations, deleteCustomField);

module.exports = router;
