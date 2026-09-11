'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  listTemplates,
  createTemplate,
  getTemplate,
  deleteTemplate,
  saveFromOpportunityBody,
} = require('../controllers/templateController');

const router = express.Router();

router.use(auditMutations);
router.use(isAuthenticated, requireStaff);

router.get('/', listTemplates);
router.post('/', createTemplate);
router.post('/from-form', saveFromOpportunityBody);
router.get('/:id', getTemplate);
router.delete('/:id', deleteTemplate);

module.exports = router;
