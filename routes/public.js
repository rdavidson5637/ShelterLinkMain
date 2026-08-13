const express = require('express');
const { apiLimiter } = require('../middleware/rateLimiter');
const {
  listPublicOpportunities,
  publicOpportunitiesIcs,
} = require('../controllers/publicController');

const router = express.Router();

// Generous public rate limit already covered by apiLimiter; keep routes open.
router.get('/opportunities', apiLimiter, listPublicOpportunities);
router.get('/opportunities.ics', apiLimiter, publicOpportunitiesIcs);

module.exports = router;
