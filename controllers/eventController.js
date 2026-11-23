'use strict';

/**
 * One-off shelter event endpoints (SL-DAY-20).
 *   GET    /api/events
 *   POST   /api/events
 *   PUT    /api/events/:id
 *   POST   /api/events/:id/archive
 *   GET    /api/events/:id/attendees
 *   POST   /api/events/:id/email
 *   POST   /api/events/:id/signup
 *   POST   /api/events/:id/cancel
 *
 * Staff manage events and may email attendees on an explicit click.
 * Volunteers sign up and cancel. Email only; no SMS. Separate from shifts.
 */

const ShelterEvent = require('../models/ShelterEvent');
const emailService = require('../utils/emailService');
const { isAdminUser } = require('../middleware/auth');

function isStaffOrAdmin(req) {
  const role = req.session?.role;
  return role === 'staff' || role === 'admin' || isAdminUser(req);
}

async function listEvents(req, res) {
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
    const items = await ShelterEvent.listEvents({
      upcomingOnly: !wantAll,
      includeArchived,
      forUserId: req.session?.role === 'volunteer' ? req.session.userId : null,
    });
    return res.status(200).json({ items, total: items.length });
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error('[Events] list error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function createEvent(req, res) {
  try {
    const item = await ShelterEvent.create({
      title: req.body?.title,
      description: req.body?.description ?? req.body?.body,
      eventDate: req.body?.event_date ?? req.body?.eventDate,
      location: req.body?.location ?? req.body?.place,
      capacity: req.body?.capacity,
      createdBy: req.session?.userId || null,
    });
    return res.status(201).json({ message: 'Event created', item });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    console.error('[Events] create error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function updateEvent(req, res) {
  try {
    const item = await ShelterEvent.update(req.params.id, {
      title: req.body?.title,
      description: req.body?.description ?? req.body?.body,
      eventDate: req.body?.event_date ?? req.body?.eventDate,
      location: req.body?.location ?? req.body?.place,
      capacity: req.body?.capacity,
    });
    return res.status(200).json({ message: 'Event updated', item });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Events] update error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function archiveEvent(req, res) {
  try {
    const item = await ShelterEvent.archive(req.params.id);
    return res.status(200).json({ message: 'Event archived', item });
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Events] archive error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function listAttendees(req, res) {
  try {
    const result = await ShelterEvent.listAttendees(req.params.id);
    return res.status(200).json({
      item: result.event,
      attendees: result.attendees,
      total: result.attendees.length,
    });
  } catch (error) {
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Events] attendees error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

/**
 * Explicit staff click only. Emails active attendees with an email address.
 * Never sends SMS. Never emails cancelled signups.
 */
async function emailAttendees(req, res) {
  try {
    const { event, recipients } = await ShelterEvent.listAttendeeRecipients(req.params.id);
    if (event.archived_at) {
      return res.status(400).json({ error: 'Archived events cannot be emailed.' });
    }
    if (!recipients.length) {
      return res.status(400).json({
        error: 'No signed-up attendees with an email address for this event.',
      });
    }

    let sent = 0;
    const failures = [];
    for (const attendee of recipients) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await emailService.sendShelterEventAttendees(attendee.email, {
          firstName: attendee.first_name || attendee.name || 'there',
          title: event.title,
          description: event.description,
          eventDate: event.event_date,
          location: event.location,
        });
        sent += 1;
      } catch (err) {
        failures.push({
          user_id: attendee.user_id,
          error: err.message || 'send failed',
        });
      }
    }

    const updated = await ShelterEvent.markEmailed(event.id, sent);
    return res.status(200).json({
      message: `Emailed ${sent} attendee${sent === 1 ? '' : 's'}`,
      item: updated,
      sent,
      failed: failures.length,
      failures: failures.slice(0, 10),
    });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Events] email error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function signUp(req, res) {
  try {
    if (req.session?.role !== 'volunteer') {
      return res.status(403).json({ error: 'Only volunteers can sign up for shelter events.' });
    }
    const item = await ShelterEvent.signUp(req.params.id, req.session.userId);
    return res.status(200).json({ message: 'Signed up', item });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Events] signup error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function cancelSignup(req, res) {
  try {
    if (req.session?.role !== 'volunteer') {
      return res.status(403).json({ error: 'Only volunteers can cancel an event sign-up.' });
    }
    const item = await ShelterEvent.cancelSignup(req.params.id, req.session.userId);
    return res.status(200).json({ message: 'Sign-up cancelled', item });
  } catch (error) {
    if (error.status === 400) return res.status(400).json({ error: error.message });
    if (error.status === 403) return res.status(403).json({ error: error.message });
    if (error.status === 404) return res.status(404).json({ error: error.message });
    console.error('[Events] cancel error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listEvents,
  createEvent,
  updateEvent,
  archiveEvent,
  listAttendees,
  emailAttendees,
  signUp,
  cancelSignup,
};
