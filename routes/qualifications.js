'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
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
// Staff manage this shelter's skill list (dog walking, cattery, reception, …).
router.post('/', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.qualification), createQualification);
router.put('/:id', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.qualification), updateQualification);
router.delete('/:id', isAuthenticated, requireStaff, auditMutations, deleteQualification);

module.exports = router;
