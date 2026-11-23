'use strict';

const express = require('express');
const { isAuthenticated } = require('../middleware/auth');
const { getMyBuddy } = require('../controllers/buddyController');

const router = express.Router();

router.get('/me', isAuthenticated, getMyBuddy);

module.exports = router;
