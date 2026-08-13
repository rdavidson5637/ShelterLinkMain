const express = require('express');
const { isAuthenticated } = require('../middleware/auth');
const {
  getMyImpactStats,
  getLeaderboard,
  getMonthlyHoursChart,
} = require('../controllers/statsController');

const router = express.Router();

router.get('/me', isAuthenticated, getMyImpactStats);
router.get('/leaderboard', isAuthenticated, getLeaderboard);
router.get('/monthly-hours', isAuthenticated, getMonthlyHoursChart);

module.exports = router;
