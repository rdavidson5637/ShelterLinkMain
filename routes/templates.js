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

const { validateBody, positiveParam } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

router.use(auditMutations);
router.use(isAuthenticated, requireStaff);

router.get('/', listTemplates);
router.post('/', validateBody(bodies.template), createTemplate);
router.post('/from-form', validateBody(bodies.templateFromForm), saveFromOpportunityBody);
router.get('/:id', getTemplate);
router.delete('/:id', deleteTemplate);

module.exports = router;
