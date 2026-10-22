'use strict';

const express = require('express');
const { isAuthenticated } = require('../middleware/auth');
const { listTags, getRecommended } = require('../controllers/tagController');

const { validateQuery } = require('../middleware/validate');
const { queries } = require('../validation/bodies');

const router = express.Router();

router.use(isAuthenticated);

router.get('/', listTags);
router.get('/recommended', validateQuery(queries.tags), getRecommended);

module.exports = router;
