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

const { validateBody, positiveParam } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

router.get('/', isAuthenticated, listQualifications);
router.get('/mine', isAuthenticated, getMyQualifications);
router.post('/', isAuthenticated, requireRole('admin'), auditMutations, validateBody(bodies.qualification), createQualification);
router.put('/:id', isAuthenticated, requireRole('admin'), auditMutations, validateBody(bodies.qualification), updateQualification);
router.delete('/:id', isAuthenticated, requireRole('admin'), auditMutations, deleteQualification);

module.exports = router;
