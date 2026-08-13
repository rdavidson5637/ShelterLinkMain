const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  createOpportunity,
  getAllOpportunities,
  getOpportunity,
  updateOpportunity,
  deleteOpportunity,
} = require('../controllers/opportunityController');

const router = express.Router();

router.post('/', isAuthenticated, requireStaff, auditMutations, createOpportunity);
router.get('/', isAuthenticated, getAllOpportunities);
router.get('/:id', isAuthenticated, getOpportunity);
router.put('/:id', isAuthenticated, requireStaff, auditMutations, updateOpportunity);
router.delete('/:id', isAuthenticated, requireStaff, auditMutations, deleteOpportunity);

module.exports = router;
