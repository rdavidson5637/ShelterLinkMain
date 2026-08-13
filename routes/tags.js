'use strict';

const express = require('express');
const { isAuthenticated } = require('../middleware/auth');
const { listTags, getRecommended } = require('../controllers/tagController');

const router = express.Router();

router.use(isAuthenticated);

router.get('/', listTags);
router.get('/recommended', getRecommended);

module.exports = router;
