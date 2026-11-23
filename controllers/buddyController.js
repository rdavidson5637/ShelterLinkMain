'use strict';

/**
 * Buddy / mentor pairing (SL-DAY-08).
 * Staff assign; optional email to the buddy on explicit assign only.
 */

const Buddy = require('../models/Buddy');
const { isStaffOrAdmin } = require('../middleware/auth');
const { isEmailConfigured } = require('../utils/emailConfig');
const emailService = require('../utils/emailService');

function ensureStaff(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  if (!isStaffOrAdmin(req)) {
    res.status(403).json({ error: 'Forbidden' });
    return false;
  }
  return true;
}

function ensureAuthed(req, res) {
  if (!req.session || !req.session.userId) {
    res.status(401).json({ error: 'Authentication required' });
    return false;
  }
  return true;
}

function truthyFlag(value) {
  return (
    value === true ||
    value === 1 ||
    value === '1' ||
    String(value || '').toLowerCase() === 'true'
  );
}

async function getVolunteerBuddy(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const summary = await Buddy.forVolunteer(req.params.userId);
    return res.status(200).json(summary);
  } catch (error) {
    console.error('[Buddy] getVolunteerBuddy error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message || 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function assignVolunteerBuddy(req, res) {
  try {
    if (!ensureStaff(req, res)) return;

    const buddyUserId = req.body?.buddy_user_id ?? req.body?.buddyUserId;
    const notify = truthyFlag(req.body?.notify);

    const result = await Buddy.assign({
      volunteerUserId: req.params.userId,
      buddyUserId,
      assignedBy: req.session.userId,
    });

    let emailed = false;
    let emailError = null;

    if (notify && result.changed) {
      if (!isEmailConfigured()) {
        return res.status(503).json({
          error: 'Email is not configured on this server.',
          pairing: result.pairing,
        });
      }
      try {
        await emailService.sendBuddyAssigned(result.buddy.email, {
          buddyFirstName: result.buddy.first_name || result.buddy.name,
          volunteerName:
            result.volunteer.first_name ||
            result.volunteer.name ||
            'a new volunteer',
        });
        const refreshed = await Buddy.markNotified(req.params.userId);
        emailed = true;
        return res.status(200).json({
          pairing: refreshed.pairing,
          changed: result.changed,
          emailed: true,
        });
      } catch (err) {
        console.error('[Buddy] notify email failed:', err.message);
        emailError = 'Buddy was assigned, but the email could not be sent.';
      }
    }

    return res.status(200).json({
      pairing: result.pairing,
      changed: result.changed,
      emailed,
      email_error: emailError,
    });
  } catch (error) {
    console.error('[Buddy] assignVolunteerBuddy error:', error.message);
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message || 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function clearVolunteerBuddy(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const result = await Buddy.clear(req.params.userId);
    return res.status(200).json({
      cleared: result.cleared,
      pairing: null,
      previous: result.pairing,
    });
  } catch (error) {
    console.error('[Buddy] clearVolunteerBuddy error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message || 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getMyBuddy(req, res) {
  try {
    if (!ensureAuthed(req, res)) return;
    const summary = await Buddy.forMe(req.session.userId);
    return res.status(200).json(summary);
  } catch (error) {
    console.error('[Buddy] getMyBuddy error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  getVolunteerBuddy,
  assignVolunteerBuddy,
  clearVolunteerBuddy,
  getMyBuddy,
};
