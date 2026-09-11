'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  createRequest,
  listRequests,
  getRequest,
  updateRequest,
  cancelRequest,
  listOffers,
  confirmOffer,
  listActivePlacements,
  endPlacement,
  listMatching,
  createOffer,
  listMyPlacements,
  logCheckIn,
  getEmergencyPhone,
} = require('../controllers/fosterController');

const router = express.Router();

router.get('/emergency-phone', isAuthenticated, getEmergencyPhone);
router.get('/matching', isAuthenticated, listMatching);
router.get('/my-placements', isAuthenticated, listMyPlacements);
router.post('/placements/:id/check-in', isAuthenticated, logCheckIn);

router.get('/placements', isAuthenticated, requireStaff, listActivePlacements);
router.post(
  '/placements/:id/end',
  isAuthenticated,
  requireStaff,
  auditMutations,
  endPlacement
);

router.get('/requests', isAuthenticated, requireStaff, listRequests);
router.post('/requests', isAuthenticated, requireStaff, auditMutations, createRequest);
router.get('/requests/:id', isAuthenticated, requireStaff, getRequest);
router.put('/requests/:id', isAuthenticated, requireStaff, auditMutations, updateRequest);
router.post(
  '/requests/:id/cancel',
  isAuthenticated,
  requireStaff,
  auditMutations,
  cancelRequest
);
router.get('/requests/:id/offers', isAuthenticated, requireStaff, listOffers);
router.post('/requests/:id/offers', isAuthenticated, createOffer);

router.post(
  '/offers/:offerId/confirm',
  isAuthenticated,
  requireStaff,
  auditMutations,
  confirmOffer
);

module.exports = router;
