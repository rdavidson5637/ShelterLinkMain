'use strict';

/**
 * Shelter announcement endpoints (SL-DAY-17).
 *   GET    /api/announcements
 *   POST   /api/announcements
 *   PUT    /api/announcements/:id
 *   POST   /api/announcements/:id/archive
 *   POST   /api/announcements/:id/email
 *
 * Volunteers see active notices only. Staff manage the list and may email
 * approved volunteers on an explicit click. Email only; no SMS.
 */

const ShelterAnnouncement = require('../models/ShelterAnnouncement');
const emailService = require('../utils/emailService');
const { isAdminUser } = require('../middleware/auth');

function isStaffOrAdmin(req) {
  const role = req.session?.role;
  return role === 'staff' || role === 'admin' || isAdminUser(req);
}

async function listAnnouncements(req, res) {
  try {
    const staff = isStaffOrAdmin(req);
    const wantAll =
      staff &&
      (req.query?.all === '1' ||
        req.query?.all === 'true' ||
        req.query?.archived === '1' ||
        req.query?.archived === 'true');
    const includeArchived =
      staff &&
      (req.query?.archived === '1' ||
        req.query?.archived === 'true' ||
        req.query?.all === '1' ||
        req.query?.all === 'true');
    const items = await ShelterAnnouncement.listAnnouncements({
      activeOnly: !wantAll,
      includeArchived,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error('[Announcements] list error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createAnnouncement(req, res) {
  try {
    const item = await ShelterAnnouncement.create({
      title: req.body?.title,
      body: req.body?.body ?? req.body?.message,
      postedOn: req.body?.posted_on ?? req.body?.postedOn,
      expiresOn: req.body?.expires_on ?? req.body?.expiresOn,
      createdBy: req.session?.userId || null,
    });
    return res.status(201).json({ message: 'Announcement posted', item });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error('[Announcements] create error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateAnnouncement(req, res) {
  try {
    const item = await ShelterAnnouncement.update(req.params.id, {
      title: req.body?.title,
      body: req.body?.body ?? req.body?.message,
      postedOn: req.body?.posted_on ?? req.body?.postedOn,
      expiresOn: req.body?.expires_on ?? req.body?.expiresOn,
    });
    return res.status(200).json({ message: 'Announcement updated', item });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Announcements] update error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function archiveAnnouncement(req, res) {
  try {
    const item = await ShelterAnnouncement.archive(req.params.id);
    return res.status(200).json({ message: 'Announcement archived', item });
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Announcements] archive error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Explicit staff click only. Emails approved active volunteers at this shelter.
 * Never sends SMS. Never emails pending, archived, or anonymised accounts.
 */
async function emailAnnouncement(req, res) {
  try {
    const item = await ShelterAnnouncement.getById(req.params.id);
    if (!item) return res.status(404).json({ error: 'Announcement not found' });
    if (item.archived_at) {
      return res.status(400).json({ error: 'Archived announcements cannot be emailed.' });
    }
    if (item.status === 'expired') {
      return res.status(400).json({ error: 'Expired announcements cannot be emailed.' });
    }

    const recipients = await ShelterAnnouncement.listActiveVolunteerRecipients();
    if (!recipients.length) {
      return res.status(400).json({
        error: 'No active volunteers with an email address at this shelter.',
      });
    }

    let sent = 0;
    const failures = [];
    for (const volunteer of recipients) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await emailService.sendShelterAnnouncement(volunteer.email, {
          firstName: volunteer.first_name || volunteer.name || 'there',
          title: item.title,
          body: item.body,
          postedOn: item.posted_on,
          expiresOn: item.expires_on,
        });
        sent += 1;
      } catch (err) {
        failures.push({ user_id: volunteer.user_id, error: err.message || 'send failed' });
      }
    }

    const updated = await ShelterAnnouncement.markEmailed(item.id, sent);
    return res.status(200).json({
      message: `Emailed ${sent} active volunteer${sent === 1 ? '' : 's'}`,
      item: updated,
      sent,
      failed: failures.length,
      failures: failures.slice(0, 10),
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Announcements] email error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listAnnouncements,
  createAnnouncement,
  updateAnnouncement,
  archiveAnnouncement,
  emailAnnouncement,
};
