'use strict';

const express = require('express');
const { isAuthenticated, requireRole } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  listWaivers,
  createWaiver,
  updateWaiver,
  getPendingWaivers,
  acceptWaiver,
} = require('../controllers/waiverController');

const { validateBody, positiveParam } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

router.get('/pending', isAuthenticated, getPendingWaivers);
router.post('/:id/accept', isAuthenticated, validateBody(bodies.waiverAccept), acceptWaiver);

router.get('/', isAuthenticated, requireRole('admin'), listWaivers);
router.post('/', isAuthenticated, requireRole('admin'), auditMutations, validateBody(bodies.waiver), createWaiver);
router.put('/:id', isAuthenticated, requireRole('admin'), auditMutations, validateBody(bodies.waiver), updateWaiver);

module.exports = router;
