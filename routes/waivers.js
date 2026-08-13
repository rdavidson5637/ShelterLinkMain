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

const router = express.Router();

router.get('/pending', isAuthenticated, getPendingWaivers);
router.post('/:id/accept', isAuthenticated, acceptWaiver);

router.get('/', isAuthenticated, requireRole('admin'), listWaivers);
router.post('/', isAuthenticated, requireRole('admin'), auditMutations, createWaiver);
router.put('/:id', isAuthenticated, requireRole('admin'), auditMutations, updateWaiver);

module.exports = router;
