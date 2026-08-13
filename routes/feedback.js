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

const router = express.Router();

// Public (signed token)
router.get('/', getFeedbackForm);
router.post('/', submitFeedback);

// Volunteer
router.get('/my-past-shifts', isAuthenticated, getMyPastShiftsForFeedback);
router.get('/link/:applicationId', isAuthenticated, getFeedbackLinkForApplication);

// Staff / admin
router.get('/admin', isAuthenticated, requireStaff, listFeedback);
router.patch('/admin/:id/handled', isAuthenticated, requireStaff, auditMutations, markFeedbackHandled);

module.exports = router;
