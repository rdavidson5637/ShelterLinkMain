'use strict';

const express = require('express');
const { isAuthenticated, requireStaff } = require('../middleware/auth');
const { auditMutations } = require('../middleware/auditLog');
const {
  getFeedbackForm,
  submitFeedback,
  getMyPastShiftsForFeedback,
  getFeedbackLinkForApplication,
  listFeedback,
  markFeedbackHandled,
} = require('../controllers/feedbackController');

const { validateBody, validateQuery, positiveParam } = require('../middleware/validate');
const { bodies, queries } = require('../validation/bodies');

const router = express.Router();
router.param('id', positiveParam('id'));
router.param('applicationId', positiveParam('applicationId'));

// Public (signed token)
router.get('/', validateQuery(queries.token), getFeedbackForm);
router.post('/', validateBody(bodies.feedback), submitFeedback);

// Volunteer
router.get('/my-past-shifts', isAuthenticated, getMyPastShiftsForFeedback);
router.get('/link/:applicationId', isAuthenticated, getFeedbackLinkForApplication);

// Staff / admin
router.get('/admin', isAuthenticated, requireStaff, validateQuery(queries.feedbackAdmin), listFeedback);
router.patch('/admin/:id/handled', isAuthenticated, requireStaff, auditMutations, validateBody(bodies.empty), markFeedbackHandled);

module.exports = router;
