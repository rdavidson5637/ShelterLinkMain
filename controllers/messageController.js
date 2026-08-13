'use strict';

const AdminMessage = require('../models/AdminMessage');
const { sendEmail } = require('../utils/emailService');

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeFilter(raw = {}) {
  return {
    profileStatus: raw.profileStatus || raw.profile_status || null,
    skill: raw.skill || null,
    minApprovedHours:
      raw.minApprovedHours != null
        ? raw.minApprovedHours
        : raw.min_approved_hours != null
          ? raw.min_approved_hours
          : null,
    opportunityId: raw.opportunityId || raw.opportunity_id || null,
  };
}

function toPlainTextHtml(subject, body) {
  const safeBody = String(body || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\n/g, '<br/>');
  return `
    <p>${safeBody}</p>
    <hr/>
    <p style="font-size:0.85em;color:#666;">
      You received this message from ShelterLink (Assisi Animal Sanctuary).
      To unsubscribe or update your contact preferences, please contact the shelter directly.
    </p>
  `;
}

async function previewRecipients(req, res) {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const filter = normalizeFilter(req.query || req.body || {});
    const recipients = await AdminMessage.resolveRecipients(filter);
    return res.status(200).json({ count: recipients.length });
  } catch (error) {
    console.error('[AdminMessages] previewRecipients error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function sendBulkMessage(req, res) {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const subject = String(req.body?.subject || '').trim();
    const body = String(req.body?.body || '').trim();
    const filter = normalizeFilter(req.body?.filter || {});

    if (!subject || !body) {
      return res.status(400).json({ error: 'subject and body are required' });
    }

    const recipients = await AdminMessage.resolveRecipients(filter);
    if (!recipients.length) {
      return res.status(400).json({ error: 'No recipients match the selected filters' });
    }

    let sent = 0;
    let failed = 0;
    const html = toPlainTextHtml(subject, body);

    for (const recipient of recipients) {
      try {
        await sendEmail(recipient.email, subject, html);
        sent += 1;
      } catch (error) {
        failed += 1;
        console.error('[AdminMessages] send failed for', recipient.email, error.message);
      }
      // Small delay to protect SMTP accounts
      await sleep(100);
    }

    const log = await AdminMessage.createMessageLog({
      adminId: req.session.userId,
      subject,
      body,
      filter,
      recipientCount: recipients.length,
    });

    return res.status(200).json({
      sent,
      failed,
      recipientCount: recipients.length,
      log,
    });
  } catch (error) {
    console.error('[AdminMessages] sendBulkMessage error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listMessages(req, res) {
  try {
    if (!req.session || req.session.role !== 'admin') {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const messages = await AdminMessage.findAll(50);
    return res.status(200).json(messages);
  } catch (error) {
    console.error('[AdminMessages] listMessages error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  previewRecipients,
  sendBulkMessage,
  listMessages,
  normalizeFilter,
};
