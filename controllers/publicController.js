'use strict';

const crypto = require('crypto');
const Opportunity = require('../models/Opportunity');
const Application = require('../models/Application');
const { pool } = require('../config/database');
const {
  filterPublicBoardOpportunities,
  isAcceptingApplications,
} = require('../utils/publicOpportunityFilter');
const { excludeTestOpportunities } = require('../utils/testOpportunityGuard');

let cache = { at: 0, data: null };
const CACHE_MS = 60 * 1000;

function escapeIcalText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

/**
 * Convert a DB timestamp ('YYYY-MM-DD' or 'YYYY-MM-DD HH:MM:SS' — see
 * config/database.js, which preserves these as plain strings) into an
 * iCalendar date/time. That string already IS the shelter's local wall-clock
 * time, so this parses it directly with a regex — never `new Date(value)`,
 * which interprets the space-separated form as SERVER-local time and
 * silently shifts it (and can roll the date near midnight) whenever the app
 * host's timezone differs from the shelter's.
 *
 * Emits a floating local time (no trailing 'Z'): calendar apps then show the
 * shift at the time it was actually entered, regardless of server timezone.
 */
function toIcalDate(value) {
  const str = String(value || '');
  const m = str.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/);
  if (!m) return null;
  const [, y, mo, d, hh, mi, ss] = m;
  if (hh == null) return `${y}${mo}${d}`;
  return `${y}${mo}${d}T${hh}${mi}${ss || '00'}`;
}

/**
 * DTSTAMP must be a real UTC instant (RFC5545) — when the feed was
 * generated — unlike the shift start/end values above, which are floating
 * local times. Takes an actual Date object, so no server-timezone ambiguity.
 */
function toIcalUtcStamp(date = new Date()) {
  return `${date.toISOString().replace(/[-:]/g, '').split('.')[0]}Z`;
}

function buildVCalendar(events, calName = 'ShelterLink') {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//ShelterLink//EN',
    `X-WR-CALNAME:${escapeIcalText(calName)}`,
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const event of events) {
    lines.push('BEGIN:VEVENT');
    lines.push(`UID:${event.uid}`);
    lines.push(`DTSTAMP:${toIcalUtcStamp()}`);
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${event.start}`);
      if (event.end) lines.push(`DTEND;VALUE=DATE:${event.end}`);
    } else {
      lines.push(`DTSTART:${event.start}`);
      if (event.end) lines.push(`DTEND:${event.end}`);
    }
    lines.push(`SUMMARY:${escapeIcalText(event.summary)}`);
    if (event.description) lines.push(`DESCRIPTION:${escapeIcalText(event.description)}`);
    if (event.location) lines.push(`LOCATION:${escapeIcalText(event.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}

function opportunityToEvent(opp) {
  const startRaw = opp.start_date;
  const endRaw = opp.end_date || opp.start_date;
  const startHasTime = String(startRaw || '').includes(':') || String(startRaw || '').includes('T');
  const start = toIcalDate(startRaw);
  let end = toIcalDate(endRaw);
  const allDay = !startHasTime;
  if (allDay && start) {
    // exclusive end date for all-day
    const endDate = new Date(`${String(endRaw).slice(0, 10)}T00:00:00Z`);
    endDate.setUTCDate(endDate.getUTCDate() + 1);
    end = toIcalDate(endDate.toISOString().slice(0, 10));
  }
  const max = Number(opp.max_volunteers);
  const filled = Number(opp.spots_filled || 0);
  const spots =
    Number.isFinite(max) && max > 0 ? Math.max(max - filled, 0) : null;

  return {
    uid: `opportunity-${opp.opportunity_id || opp.id}@shelterlink`,
    start,
    end,
    allDay,
    summary: opp.title || 'Volunteer shift',
    description: opp.description || '',
    location: opp.location || '',
    spotsRemaining: spots,
  };
}

function toPublicOpportunity(opp) {
  const max = Number(opp.max_volunteers);
  const filled = Number(opp.spots_filled || 0);
  const spotsRemaining =
    Number.isFinite(max) && max > 0 ? Math.max(max - filled, 0) : null;
  return {
    id: opp.id || opp.opportunity_id,
    title: opp.title,
    description: opp.description,
    date: opp.start_date,
    start_date: opp.start_date,
    end_date: opp.end_date,
    time: null,
    location: opp.location,
    spots_remaining: spotsRemaining,
    is_urgent: Boolean(Number(opp.is_urgent)),
    accepting_applications: isAcceptingApplications({ ...opp, spots_remaining: spotsRemaining }),
  };
}

async function loadUpcomingPublicOpportunities() {
  const raw = excludeTestOpportunities(await Opportunity.findAll({ status: 'open' }));
  const all = filterPublicBoardOpportunities(raw);
  const future = all.filter((opp) => {
    const start = new Date(opp.start_date);
    return !Number.isNaN(start.getTime()) && start.getTime() >= Date.now() - 12 * 60 * 60 * 1000;
  });
  future.sort((a, b) => {
    const aUrgent = Number(a.is_urgent) ? 1 : 0;
    const bUrgent = Number(b.is_urgent) ? 1 : 0;
    if (aUrgent !== bUrgent) return bUrgent - aUrgent;
    return new Date(a.start_date) - new Date(b.start_date);
  });
  return future;
}

async function listPublicOpportunities(req, res) {
  try {
    const now = Date.now();
    if (cache.data && now - cache.at < CACHE_MS) {
      return res.status(200).json(cache.data);
    }

    const future = await loadUpcomingPublicOpportunities();
    const payload = future.map(toPublicOpportunity);
    cache = { at: now, data: payload };
    return res.status(200).json(payload);
  } catch (error) {
    console.error('[Public] listPublicOpportunities error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function publicOpportunitiesIcs(req, res) {
  try {
    const future = await loadUpcomingPublicOpportunities();
    const events = future.map(opportunityToEvent).filter((e) => e.start);
    const body = buildVCalendar(events, 'ShelterLink Open Shifts');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="shelterlink-opportunities.ics"');
    return res.status(200).send(body);
  } catch (error) {
    console.error('[Public] publicOpportunitiesIcs error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function ensureIcalToken(userId) {
  const [rows] = await pool.execute(
    `SELECT user_id, ical_token FROM users WHERE user_id = ? LIMIT 1`,
    [userId]
  );
  const user = rows[0];
  if (!user) return null;
  if (user.ical_token) return user.ical_token;
  const token = crypto.randomBytes(24).toString('hex');
  await pool.execute(`UPDATE users SET ical_token = ? WHERE user_id = ?`, [token, userId]);
  return token;
}

async function getMyIcalToken(req, res) {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });
    const token = await ensureIcalToken(req.session.userId);
    if (!token) return res.status(404).json({ error: 'User not found' });
    const url = `${req.protocol}://${req.get('host')}/api/my-shifts.ics?token=${token}`;
    return res.status(200).json({ token, url });
  } catch (error) {
    console.error('[Public] getMyIcalToken error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function myShiftsIcs(req, res) {
  try {
    const token = String(req.query.token || '').trim();
    if (!token) return res.status(404).json({ error: 'Not found' });

    const [users] = await pool.execute(
      `SELECT user_id FROM users WHERE ical_token = ? LIMIT 1`,
      [token]
    );
    if (!users.length) return res.status(404).json({ error: 'Not found' });

    const apps = await Application.findByUserId(users[0].user_id);
    const upcoming = apps.filter((app) => {
      const status = (app.status || '').toLowerCase();
      if (status !== 'accepted' && status !== 'approved') return false;
      const start = new Date(app.opportunity_start_date);
      return !Number.isNaN(start.getTime()) && start.getTime() >= Date.now() - 12 * 60 * 60 * 1000;
    });

    const events = upcoming.map((app) => ({
      uid: `application-${app.application_id || app.id}@shelterlink`,
      start: toIcalDate(app.opportunity_start_date),
      end: toIcalDate(app.opportunity_end_date || app.opportunity_start_date),
      allDay: !String(app.opportunity_start_date || '').includes(':'),
      summary: app.opportunity_title || 'Volunteer shift',
      description: 'Accepted ShelterLink shift',
      location: app.opportunity_location || '',
    })).filter((e) => e.start);

    const body = buildVCalendar(events, 'My ShelterLink Shifts');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'inline; filename="my-shifts.ics"');
    return res.status(200).send(body);
  } catch (error) {
    console.error('[Public] myShiftsIcs error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

async function applicationIcs(req, res) {
  try {
    if (!req.session?.userId) return res.status(401).json({ error: 'Unauthorized' });
    const app = await Application.findById(req.params.id);
    if (!app) return res.status(404).json({ error: 'Not found' });
    if (Number(app.user_id) !== Number(req.session.userId)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    const event = {
      uid: `application-${app.application_id}@shelterlink`,
      start: toIcalDate(app.opportunity_start_date),
      end: toIcalDate(app.opportunity_end_date || app.opportunity_start_date),
      allDay: !String(app.opportunity_start_date || '').includes(':'),
      summary: app.opportunity_title || 'Volunteer shift',
      description: 'ShelterLink shift',
      location: app.opportunity_location || '',
    };
    const body = buildVCalendar([event], 'ShelterLink Shift');
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="shift-${app.application_id}.ics"`);
    return res.status(200).send(body);
  } catch (error) {
    console.error('[Public] applicationIcs error:', error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  listPublicOpportunities,
  publicOpportunitiesIcs,
  myShiftsIcs,
  getMyIcalToken,
  applicationIcs,
  escapeIcalText,
  buildVCalendar,
  toIcalDate,
  toPublicOpportunity,
  _resetCacheForTests: () => { cache = { at: 0, data: null }; },
};
