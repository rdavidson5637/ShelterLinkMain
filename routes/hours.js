const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  logHours,
  getMyHours,
  getAllPendingHours,
  approveHours,
  getVolunteerStats,
} = require('../controllers/hoursController');

const router = express.Router();

router.post('/', isAuthenticated, logHours);
router.get('/my-hours', isAuthenticated, getMyHours);
router.get('/pending', isAuthenticated, requireStaff, getAllPendingHours);
router.put('/:id/approve', isAuthenticated, requireStaff, auditMutations, approveHours);
router.get('/stats', isAuthenticated, getVolunteerStats);

module.exports = router;
