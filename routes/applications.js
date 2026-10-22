const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  applyForOpportunity,
  getMyApplications,
  getAllApplications,
  updateApplicationStatus,
  cancelApplication,
  markApplicationNoShow,
  checkInApplication,
  checkOutApplication,
} = require('../controllers/applicationController');
const {
  requestSwap,
  listAvailableSwaps,
  claimSwap,
  claimSwapByToken,
  cancelSwap,
} = require('../controllers/swapController');
const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));

router.post('/', isAuthenticated, validateBody(bodies.apply), applyForOpportunity);
router.get('/my-applications', isAuthenticated, getMyApplications);
router.get('/swaps/available', isAuthenticated, listAvailableSwaps);
router.post('/swaps/claim-by-token', isAuthenticated, validateBody(bodies.claimToken), claimSwapByToken);
router.post('/swaps/:id/claim', isAuthenticated, validateBody(bodies.empty), claimSwap);
router.delete('/swaps/:id', isAuthenticated, cancelSwap);
router.post('/:id/swap', isAuthenticated, validateBody(bodies.empty), requestSwap);
router.get('/', isAuthenticated, requireStaff, validateQuery(queries.applications), getAllApplications);
router.put('/:id', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.applicationStatus), updateApplicationStatus);
router.patch('/:id/no-show', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.empty), markApplicationNoShow);
router.post('/:id/check-in', isAuthenticated, validateBody(bodies.checkCode), checkInApplication);
router.post('/:id/check-out', isAuthenticated, validateBody(bodies.checkCode), checkOutApplication);
router.delete('/:id', isAuthenticated, cancelApplication);

module.exports = router;
