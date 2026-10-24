const express = require('express');
const { isAuthenticated } = require('../middleware/auth');
const {
  getMyImpactStats,
  getLeaderboard,
  getMonthlyHoursChart,
} = require('../controllers/statsController');

const { validateQuery } = require('../middleware/validate');
const { queries } = require('../validation/bodies');

const router = express.Router();

router.get('/me', isAuthenticated, getMyImpactStats);
router.get('/leaderboard', isAuthenticated, validateQuery(queries.year), getLeaderboard);
router.get('/monthly-hours', isAuthenticated, validateQuery(queries.year), getMonthlyHoursChart);

module.exports = router;
