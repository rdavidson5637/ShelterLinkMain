'use strict';

const Application = require('../models/Application');
const ShiftFeedback = require('../models/ShiftFeedback');
const {
  createFeedbackToken,
  verifyFeedbackToken,
} = require('../utils/feedbackToken');
const { averageRating, averagesByOpportunity } = require('../utils/feedbackMath');
const { sendFeedbackConcernAlert } = require('../utils/emailService');
const { isStaffOrAdmin } = require('../middleware/auth');

function ensureAuthenticated(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

function isAdmin(req) {
  return isStaffOrAdmin(req);
}

function appBaseUrl(req) {
  return process.env.APP_URL || `${req.protocol}://${req.get('host')}`;
}

function feedbackPageUrl(req, token) {
  return `${appBaseUrl(req)}/pages/feedback.html?token=${encodeURIComponent(token)}`;
}

async function loadTokenContext(token) {
  const verified = verifyFeedbackToken(token);
  if (!verified) return { error: 'Invalid or expired feedback link', status: 400 };

  const application = await Application.findById(verified.applicationId);
  if (!application) return { error: 'Application not found', status: 404 };
  if (application.status !== 'accepted' && application.status !== 'approved') {
    return { error: 'Feedback is only available for accepted shifts', status: 400 };
  }

  const existing = await ShiftFeedback.findByApplicationId(verified.applicationId);
  return { application, existing, applicationId: verified.applicationId };
}

/**
 * Public: load opportunity details for the feedback form via signed token.
 */
async function getFeedbackForm(req, res) {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) {
      return res.status(400).json({ error: 'Feedback token is required' });
    }

    const ctx = await loadTokenContext(token);
    if (ctx.error) {
      return res.status(ctx.status).json({ error: ctx.error });
    }

    return res.status(200).json({
      application_id: ctx.application.application_id,
      opportunity_id: ctx.application.opportunity_id,
      opportunity_title: ctx.application.opportunity_title,
      opportunity_start_date: ctx.application.opportunity_start_date,
      already_submitted: Boolean(ctx.existing),
      existing: ctx.existing
        ? {
            rating: ctx.existing.rating,
            comment: ctx.existing.comment,
            flag_concern: ctx.existing.flag_concern,
            created_at: ctx.existing.created_at,
          }
        : null,
    });
  } catch (error) {
    console.error('[Feedback] getFeedbackForm error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Public: submit feedback with signed token (no login).
 */
async function submitFeedback(req, res) {
  try {
    const { token, rating, comment, flag_concern: flagConcern } = req.body || {};
    if (!token || typeof token !== 'string') {
      return res.status(400).json({ error: 'Feedback token is required' });
    }

    const ratingNum = Number(rating);
    if (!Number.isInteger(ratingNum) || ratingNum < 1 || ratingNum > 5) {
      return res.status(400).json({ error: 'Rating must be an integer from 1 to 5' });
    }

    const ctx = await loadTokenContext(token);
    if (ctx.error) {
      return res.status(ctx.status).json({ error: ctx.error });
    }
    if (ctx.existing) {
      return res.status(409).json({ error: 'Feedback already submitted for this shift' });
    }

    const wantFlag = Boolean(flagConcern);
    let feedback;
    try {
      feedback = await ShiftFeedback.create({
        applicationId: ctx.applicationId,
        rating: ratingNum,
        comment: comment ? String(comment).slice(0, 5000) : null,
        flagConcern: wantFlag,
      });
    } catch (error) {
      if (error && (error.code === 'ER_DUP_ENTRY' || /Duplicate/i.test(error.message))) {
        return res.status(409).json({ error: 'Feedback already submitted for this shift' });
      }
      throw error;
    }

    if (wantFlag) {
      try {
        const admins = await ShiftFeedback.findAdminEmails();
        await Promise.all(
          admins.map((email) =>
            sendFeedbackConcernAlert(email, {
              volunteerName: ctx.application.volunteer_name || ctx.application.name || 'A volunteer',
              title: ctx.application.opportunity_title,
              date: ctx.application.opportunity_start_date,
              rating: ratingNum,
              comment: comment || '',
            })
          )
        );
      } catch (mailError) {
        console.error('[Feedback] concern alert email failed:', mailError.message);
      }
    }

    return res.status(201).json({
      message: 'Thank you for your feedback',
      feedback: {
        id: feedback.id,
        rating: feedback.rating,
        flag_concern: feedback.flag_concern,
      },
    });
  } catch (error) {
    console.error('[Feedback] submitFeedback error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Volunteer: past shifts with feedback links.
 */
async function getMyPastShiftsForFeedback(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const rows = await ShiftFeedback.findPastShiftsForUser(req.session.userId);
    const items = rows.map((row) => {
      const token = row.has_feedback ? null : createFeedbackToken(row.application_id);
      return {
        application_id: row.application_id,
        opportunity_id: row.opportunity_id,
        opportunity_title: row.opportunity_title,
        opportunity_start_date: row.opportunity_start_date,
        has_feedback: row.has_feedback,
        feedback_rating: row.feedback_rating || null,
        feedback_url: token ? feedbackPageUrl(req, token) : null,
        token,
      };
    });
    return res.status(200).json(items);
  } catch (error) {
    console.error('[Feedback] getMyPastShiftsForFeedback error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Volunteer: get a feedback link for one of their past accepted applications.
 */
async function getFeedbackLinkForApplication(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const applicationId = Number(req.params.applicationId);
    if (!Number.isInteger(applicationId) || applicationId < 1) {
      return res.status(400).json({ error: 'Invalid application id' });
    }

    const application = await Application.findById(applicationId);
    if (!application) {
      return res.status(404).json({ error: 'Application not found' });
    }
    if (Number(application.user_id) !== Number(req.session.userId) && !isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    if (application.status !== 'accepted' && application.status !== 'approved') {
      return res.status(400).json({ error: 'Feedback is only available for accepted shifts' });
    }

    const start = application.opportunity_start_date
      ? new Date(application.opportunity_start_date)
      : null;
    if (!start || Number.isNaN(start.getTime()) || start >= new Date()) {
      return res.status(400).json({ error: 'Feedback is only available after the shift date' });
    }

    const existing = await ShiftFeedback.findByApplicationId(applicationId);
    if (existing) {
      return res.status(200).json({
        already_submitted: true,
        feedback_url: null,
        feedback: {
          rating: existing.rating,
          created_at: existing.created_at,
        },
      });
    }

    const token = createFeedbackToken(applicationId);
    return res.status(200).json({
      already_submitted: false,
      token,
      feedback_url: feedbackPageUrl(req, token),
    });
  } catch (error) {
    console.error('[Feedback] getFeedbackLinkForApplication error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Admin: list feedback + averages.
 */
async function listFeedback(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const filters = {
      opportunityId: req.query.opportunityId,
      flagConcern: req.query.flagConcern,
      handled: req.query.handled,
      minRating: req.query.minRating,
      maxRating: req.query.maxRating,
    };

    const items = await ShiftFeedback.findAll(filters);
    // Averages use the unfiltered set for overall/per-opportunity stats when no opportunity filter,
    // but when filtered by opportunity still compute from the returned set for consistency.
    const forAverages =
      filters.opportunityId || filters.minRating || filters.maxRating || filters.flagConcern != null || filters.handled != null
        ? items
        : await ShiftFeedback.findAll({});

    const overall = averageRating(forAverages.map((r) => r.rating));
    const byOpportunity = averagesByOpportunity(forAverages);

    return res.status(200).json({
      items,
      averages: {
        overall,
        count: forAverages.length,
        byOpportunity,
      },
    });
  } catch (error) {
    console.error('[Feedback] listFeedback error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Admin: mark a flagged concern as handled.
 */
async function markFeedbackHandled(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id < 1) {
      return res.status(400).json({ error: 'Invalid feedback id' });
    }

    const updated = await ShiftFeedback.markHandled(id);
    if (!updated) {
      return res.status(404).json({
        error: 'Feedback not found, not flagged, or already handled',
      });
    }
    return res.status(200).json({ message: 'Concern marked as handled', feedback: updated });
  } catch (error) {
    console.error('[Feedback] markFeedbackHandled error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getFeedbackForm,
  submitFeedback,
  getMyPastShiftsForFeedback,
  getFeedbackLinkForApplication,
  listFeedback,
  markFeedbackHandled,
  // exported for tests
  _loadTokenContext: loadTokenContext,
};
