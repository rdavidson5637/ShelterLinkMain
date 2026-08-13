const VolunteerHours = require('../models/VolunteerHours');
const Application = require('../models/Application');
const User = require('../models/User');
const { sendHoursApproval } = require('../utils/emailService');
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

async function logHours(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;
    const { opportunityId, date, hours } = req.body || {};

    // Validate required fields
    if (!opportunityId || !date || typeof hours !== 'number') {
      return res.status(400).json({ error: 'opportunityId, date, and hours are required' });
    }

    // Validate hours range
    if (hours < 0.5 || hours > 24) {
      return res.status(400).json({ error: 'Hours must be between 0.5 and 24' });
    }

    // Validate date is not in future
    const logDate = new Date(date);
    const today = new Date();
    today.setHours(23, 59, 59, 999);

    if (logDate > today) {
      return res.status(400).json({
        error: 'Cannot log hours for future dates',
      });
    }

    // Check if volunteer has approved application for this opportunity
    const applications = await Application.findByUserId(userId);
    const opportunityIdNum = Number(opportunityId);
    const approvedApplication = applications.find(
      (app) =>
        Number(app.opportunity_id) === opportunityIdNum &&
        (app.status === 'accepted' || app.status === 'approved')
    );

    if (!approvedApplication) {
      return res.status(403).json({ error: 'You must have an approved application for this opportunity to log hours' });
    }

    // Create hour entry
    await VolunteerHours.create(userId, opportunityId, date, hours);
    return res.status(201).json({ message: 'Hours logged successfully' });
  } catch (error) {
    console.error('[Hours] logHours error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMyHours(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;

    const hours = await VolunteerHours.findByUserId(userId);
    return res.status(200).json(hours);
  } catch (error) {
    console.error('[Hours] getMyHours error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getAllPendingHours(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const hours = await VolunteerHours.findPending();
    return res.status(200).json(hours);
  } catch (error) {
    console.error('[Hours] getAllPendingHours error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function approveHours(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    if (!isAdmin(req)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { id } = req.params;
    const hours = await VolunteerHours.approve(id);
    if (!hours) {
      return res.status(404).json({ error: 'Hours entry not found' });
    }

    // Email notification should not block response
    try {
      const user = await User.findById(hours.user_id);
      if (user?.email) {
        await sendHoursApproval(
          user.email,
          hours.hours,
          hours.opportunity_title || 'Opportunity'
        );
      }
    } catch (emailError) {
      console.error('[Hours] approveHours email error:', emailError.message);
    }

    return res.status(200).json({ message: 'Hours approved successfully' });
  } catch (error) {
    console.error('[Hours] approveHours error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getVolunteerStats(req, res) {
  try {
    if (!ensureAuthenticated(req, res)) return;
    const userId = req.session.userId;

    // Calculate total approved hours
    const totalHours = await VolunteerHours.getTotalHours(userId);

    // Count active applications (approved or pending)
    const applications = await Application.findByUserId(userId);
    const activeApplications = applications.filter(
      (app) =>
        app.status === 'accepted' ||
        app.status === 'approved' ||
        app.status === 'pending'
    ).length;

    return res.status(200).json({
      totalHours,
      activeApplications,
    });
  } catch (error) {
    console.error('[Hours] getVolunteerStats error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  logHours,
  getMyHours,
  getAllPendingHours,
  approveHours,
  getVolunteerStats,
};

