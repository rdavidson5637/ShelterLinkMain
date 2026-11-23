'use strict';

/**
 * Staff expiry dashboard (SL-DAY-12).
 * List checks/documents/qualifications expiring soon; optional email reminder
 * only when staff explicitly clicks send. Email only, no SMS.
 */

const ExpiryDashboard = require('../models/ExpiryDashboard');
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

function truthyFlag(value) {
  return (
    value === true ||
    value === 1 ||
    value === '1' ||
    String(value || '').toLowerCase() === 'true'
  );
}

async function listExpiringItems(req, res) {
  try {
    if (!ensureStaff(req, res)) return;
    const days = req.query?.days;
    const result = await ExpiryDashboard.listExpiring({ days });
    return res.status(200).json(result);
  } catch (error) {
    console.error('[ExpiryDashboard] listExpiringItems error:', error.message);
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Send an optional expiry reminder email. Never auto-sends.
 * Body: { kind, id, message? } — message is an optional short staff note.
 */
async function sendExpiryReminder(req, res) {
  try {
    if (!ensureStaff(req, res)) return;

    const kind = String(req.body?.kind || '').trim();
    const id = req.body?.id;
    const message =
      req.body?.message != null ? String(req.body.message).trim().slice(0, 2000) : '';
    const sendEmailFlag = truthyFlag(req.body?.send_email ?? true);

    if (!ExpiryDashboard.KINDS.has(kind)) {
      return res.status(400).json({ error: 'Choose a background check, document, or qualification.' });
    }

    const row = await ExpiryDashboard.findForReminder(kind, id);
    if (!row) {
      return res.status(404).json({ error: 'Item not found' });
    }
    if (!row.email) {
      return res.status(400).json({ error: 'This volunteer has no email address on file.' });
    }

    if (!sendEmailFlag) {
      return res.status(400).json({ error: 'Set send_email to send a reminder.' });
    }

    if (!isEmailConfigured()) {
      return res.status(503).json({ error: 'Email is not configured on this server.' });
    }

    try {
      await emailService.sendExpiryReminder(row.email, {
        firstName: row.first_name,
        itemLabel: row.label,
        kind: row.kind,
        expiresOn: row.expires_on,
        message,
      });
    } catch (emailError) {
      console.error('[ExpiryDashboard] reminder email error:', emailError.message);
      return res.status(502).json({ error: 'Failed to send reminder email' });
    }

    await ExpiryDashboard.markReminderSent(kind, row.id);

    return res.status(200).json({
      email_sent: true,
      kind: row.kind,
      id: row.id,
      user_id: row.user_id,
    });
  } catch (error) {
    console.error('[ExpiryDashboard] sendExpiryReminder error:', error.message);
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: 'Not found' });
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listExpiringItems,
  sendExpiryReminder,
};
