'use strict';

const express = require('express');
const { isAuthenticated } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const { validateBody } = require('../middleware/validate');
const bodies = require('../validation/bodies');
const {
  listMine,
  saveMine,
} = require('../controllers/volunteerShiftNoteController');

const router = express.Router();

router.get('/mine', isAuthenticated, listMine);
router.post(
  '/',
  isAuthenticated,
  auditMutations,
  validateBody(bodies.volunteerShiftNote),
  saveMine
);

module.exports = router;
