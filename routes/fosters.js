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

const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));
router.param('offerId', positiveParam('offerId'));

router.get('/emergency-phone', isAuthenticated, getEmergencyPhone);
router.get('/matching', isAuthenticated, listMatching);
router.get('/my-placements', isAuthenticated, listMyPlacements);
router.post('/placements/:id/check-in', isAuthenticated, validateBody(bodies.fosterCheckIn), logCheckIn);

router.get('/placements', isAuthenticated, requireStaff, validateQuery(queries.active), listActivePlacements);
router.post(
  '/placements/:id/end',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.empty),
  endPlacement
);

router.get('/requests', isAuthenticated, requireStaff, validateQuery(queries.status), listRequests);
router.post('/requests', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.fosterRequest), createRequest);
router.get('/requests/:id', isAuthenticated, requireStaff, getRequest);
router.put('/requests/:id', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.fosterRequest), updateRequest);
router.post(
  '/requests/:id/cancel',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.empty),
  cancelRequest
);
router.get('/requests/:id/offers', isAuthenticated, requireStaff, listOffers);
router.post('/requests/:id/offers', isAuthenticated, validateBody(bodies.fosterOffer), createOffer);

router.post(
  '/offers/:offerId/confirm',
  isAuthenticated,
  requireStaff,
  auditMutations,
  validateBody(bodies.empty),
  confirmOffer
);

module.exports = router;
