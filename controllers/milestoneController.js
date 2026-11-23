'use strict';

/**
 * Staff milestone notices and thank-you emails (SL-DAY-06).
 * Email only, staff click required, deduped per volunteer + kind.
 */

const Milestone = require('../models/Milestone');
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

async function listPendingMilestones(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const summary = await Milestone.listPending();
    return res.status(200).json(summary);
  } catch (error) {
    console.error('[Milestone] listPendingMilestones error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function getVolunteerMilestones(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const summary = await Milestone.forVolunteer(req.params.userId);
    return res.status(200).json(summary);
  } catch (error) {
    console.error('[Milestone] getVolunteerMilestones error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function previewMilestoneEmail(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const kind = String(req.params.kind || '');
    if (!Milestone.isKind(kind)) {
      return res.status(400).json({ error: 'Unknown milestone' });
    }
    const { volunteer, item } = await Milestone.assertReachable(req.params.userId, kind);
    const brand = await emailService.brandBits();
    const parts = emailService.buildMilestoneThankYou(
      {
        firstName: volunteer.first_name || volunteer.name,
        kind,
        label: item.label,
        attended: item.attended,
      },
      brand
    );
    return res.status(200).json({
      kind,
      label: item.label,
      to: volunteer.email,
      subject: parts.subject,
      html: parts.html,
      text: parts.text,
      sends_mail: false,
    });
  } catch (error) {
    console.error('[Milestone] previewMilestoneEmail error:', error.message);
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message || 'Not found' });
    if (error.status === 409) {
      return res.status(409).json({ error: error.message, emailed_at: error.emailed_at || null });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function sendMilestoneEmail(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const kind = String(req.params.kind || '');
    if (!Milestone.isKind(kind)) {
      return res.status(400).json({ error: 'Unknown milestone' });
    }

    // Resolve the volunteer first so cross-shelter ids stay 404, not 503.
    const { volunteer, item } = await Milestone.assertReachable(req.params.userId, kind);
    if (!isEmailConfigured()) {
      return res.status(503).json({
        error: 'Email is not set up on this server, so thank-you emails cannot be sent yet.',
      });
    }
    if (!volunteer.email) {
      return res.status(400).json({ error: 'This volunteer has no email address on file.' });
    }

    // Dedup first so two concurrent clicks cannot both send.
    const recorded = await Milestone.recordEmail(volunteer.user_id, kind, req.session.userId);
    if (!recorded) {
      const existing = await Milestone.alreadyEmailed(volunteer.user_id, kind);
      return res.status(409).json({
        error: 'A thank-you for this milestone was already sent',
        emailed_at: existing ? existing.emailed_at : null,
      });
    }

    try {
      await emailService.sendMilestoneThankYou(volunteer.email, {
        firstName: volunteer.first_name,
        kind,
        label: item.label,
        attended: item.attended,
      });
    } catch (emailError) {
      console.error('[Milestone] send failed:', emailError.message);
      // Best-effort undo so staff can retry after fixing mail.
      try {
        const { pool } = require('../config/database');
        await pool.execute('DELETE FROM volunteer_milestone_emails WHERE id = ?', [recorded.id]);
      } catch (undoError) {
        console.error('[Milestone] could not undo dedup row:', undoError.message);
      }
      return res.status(502).json({ error: 'The thank-you email could not be sent. Try again later.' });
    }

    return res.status(200).json({
      ok: true,
      kind,
      label: item.label,
      emailed_at: recorded.emailed_at,
      to: volunteer.email,
    });
  } catch (error) {
    console.error('[Milestone] sendMilestoneEmail error:', error.message);
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message || 'Not found' });
    if (error.status === 409) {
      return res.status(409).json({ error: error.message, emailed_at: error.emailed_at || null });
    }
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listPendingMilestones,
  getVolunteerMilestones,
  previewMilestoneEmail,
  sendMilestoneEmail,
};
