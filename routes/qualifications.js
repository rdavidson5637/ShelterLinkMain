'use strict';

const express = require('express');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  listQualifications,
  createQualification,
  updateQualification,
  deleteQualification,
  getMyQualifications,
} = require('../controllers/qualificationController');

const router = express.Router();

router.get('/', isAuthenticated, listQualifications);
router.get('/mine', isAuthenticated, getMyQualifications);
router.post('/', isAuthenticated, requireRole('admin'), auditMutations, createQualification);
router.put('/:id', isAuthenticated, requireRole('admin'), auditMutations, updateQualification);
router.delete('/:id', isAuthenticated, requireRole('admin'), auditMutations, deleteQualification);

module.exports = router;
