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

const { validateBody, positiveParam } = require('../middleware/validate');
const { bodies } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

router.post('/', isAuthenticated, validateBody(bodies.hours), logHours);
router.get('/my-hours', isAuthenticated, getMyHours);
router.get('/pending', isAuthenticated, requireStaff, getAllPendingHours);
router.put('/:id/approve', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.empty), approveHours);
router.get('/stats', isAuthenticated, getVolunteerStats);

module.exports = router;
