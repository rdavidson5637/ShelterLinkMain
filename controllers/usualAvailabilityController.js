'use strict';

/**
 * Usual volunteer availability (SL-DAY-14).
 * Volunteers set usual days/parts; staff list matches for a short-staffed
 * shift and email one person on an explicit click. Email only; no SMS.
 */

const UsualAvailability = require('../models/UsualAvailability');
const { isStaffOrAdmin } = require('../middleware/auth');
const { isEmailConfigured } = require('../utils/emailConfig');
const emailService = require('../utils/emailService');
const { formatShelterDate, formatShelterTime } = require('../utils/shelterTime');

function ensureAuthed(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  return true;
}

function ensureStaff(req, res) {
  if (!ensureAuthed(req, res)) return false;
  if (!isStaffOrAdmin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function formatWhen(startDate, endDate) {
  const day = formatShelterDate(startDate);
  const startTime = formatShelterTime(startDate);
  const endTime = formatShelterTime(endDate);
  if (startTime && endTime) return `${day}, ${startTime} - ${endTime}`;
  if (startTime) return `${day}, ${startTime}`;
  return day;
}

async function getMyUsualAvailability(req, res) {
  try {
    if (!ensureAuthed(req, res)) return;
    const summary = await UsualAvailability.listForUser(req.session.userId);
    return res.status(200).json(summary);
  } catch (error) {
    console.error('[UsualAvailability] getMyUsualAvailability error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 400) return res.status(400).json({ error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function putMyUsualAvailability(req, res) {
  try {
    if (!ensureAuthed(req, res)) return;
    const slots = req.body?.slots ?? req.body?.availability ?? [];
    const summary = await UsualAvailability.replaceForUser(req.session.userId, slots);
    return res.status(200).json(summary);
  } catch (error) {
    console.error('[UsualAvailability] putMyUsualAvailability error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listUsualAvailabilityForOpportunity(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const summary = await UsualAvailability.listMatchesForOpportunity(req.params.id);
    return res.status(200).json(summary);
  } catch (error) {
    console.error('[UsualAvailability] listUsualAvailabilityForOpportunity error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message || 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Email one usually-available volunteer about a short-staffed shift.
 * Never auto-sends; staff must POST explicitly.
 */
async function emailUsualAvailabilityMatch(req, res) {
  try {
    if (!ensureStaff(req, res)) return;

    const userId = req.body?.user_id ?? req.body?.userId;
    const { summary, volunteer } = await UsualAvailability.findMatchVolunteer(
      req.params.id,
      userId
    );

    if (!summary.opportunity.short_staffed) {
      return res.status(400).json({
        error: 'This shift is not short-staffed. Usual availability is for filling open places.',
      });
    }

    if (!volunteer.email) {
      return res.status(400).json({ error: 'This volunteer has no email address on file.' });
    }

    if (!isEmailConfigured()) {
      return res.status(503).json({ error: 'Email is not configured on this server.' });
    }

    await emailService.sendUsualAvailabilityAsk(volunteer.email, {
      firstName: volunteer.first_name || volunteer.name,
      opportunityTitle: summary.opportunity.title,
      whenLabel: formatWhen(summary.opportunity.start_date, summary.opportunity.end_date),
      location: summary.opportunity.location || '',
      matchLabel: `${summary.match.weekday_label} ${summary.match.part_label.toLowerCase()}`,
    });

    return res.status(200).json({
      emailed: true,
      user_id: volunteer.user_id,
      opportunity_id: summary.opportunity.opportunity_id,
    });
  } catch (error) {
    console.error('[UsualAvailability] emailUsualAvailabilityMatch error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message || 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getMyUsualAvailability,
  putMyUsualAvailability,
  listUsualAvailabilityForOpportunity,
  emailUsualAvailabilityMatch,
};
