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

const router = express.Router();

router.post('/', isAuthenticated, applyForOpportunity);
router.get('/my-applications', isAuthenticated, getMyApplications);
router.get('/swaps/available', isAuthenticated, listAvailableSwaps);
router.post('/swaps/claim-by-token', isAuthenticated, claimSwapByToken);
router.post('/swaps/:id/claim', isAuthenticated, claimSwap);
router.delete('/swaps/:id', isAuthenticated, cancelSwap);
router.post('/:id/swap', isAuthenticated, requestSwap);
router.get('/', isAuthenticated, requireStaff, getAllApplications);
router.put('/:id', isAuthenticated, requireStaff, auditMutations, updateApplicationStatus);
router.patch('/:id/no-show', isAuthenticated, requireStaff, auditMutations, markApplicationNoShow);
router.post('/:id/check-in', isAuthenticated, checkInApplication);
router.post('/:id/check-out', isAuthenticated, checkOutApplication);
router.delete('/:id', isAuthenticated, cancelApplication);

module.exports = router;
