'use strict';

/**
 * Usual days and parts of day a volunteer can help (SL-DAY-14).
 * Staff match these to short-staffed shifts in the same shelter only.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');
const { todayIso, calendarDay } = require('../utils/shelterTime');

const WEEKDAYS = Object.freeze(['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']);
const PARTS = Object.freeze(['morning', 'afternoon', 'evening']);
const WEEKDAY_LABELS = Object.freeze({
  mon: 'Monday',
  tue: 'Tuesday',
  wed: 'Wednesday',
  thu: 'Thursday',
  fri: 'Friday',
  sat: 'Saturday',
  sun: 'Sunday',
});
const PART_LABELS = Object.freeze({
  morning: 'Morning',
  afternoon: 'Afternoon',
  evening: 'Evening',
});
const JS_DAY_TO_WEEKDAY = Object.freeze(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']);

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireShelterId() {
  const id = currentShelterId();
  if (!id) throw fail(403, 'Shelter context is missing');
  return id;
}

function normaliseWeekday(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase()
    .slice(0, 3);
  return WEEKDAYS.includes(key) ? key : null;
}

function normalisePart(value) {
  const key = String(value || '')
    .trim()
    .toLowerCase();
  return PARTS.includes(key) ? key : null;
}

/**
 * Morning before 12:00, afternoon 12:00–16:59, evening from 17:00.
 */
function partOfDayFromHour(hour) {
  const h = Number(hour);
  if (!Number.isFinite(h)) return 'morning';
  if (h < 12) return 'morning';
  if (h < 17) return 'afternoon';
  return 'evening';
}

function weekdayFromDateOnly(dateOnly) {
  const day = String(dateOnly || '').slice(0, 10);
  const m = day.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const utc = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (Number.isNaN(utc.getTime())) return null;
  return JS_DAY_TO_WEEKDAY[utc.getUTCDay()] || null;
}

function hourFromTimestamp(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.getUTCHours();
  }
  const raw = String(value).trim();
  const m = raw.match(/[ T](\d{2}):(\d{2})/);
  if (!m) return null;
  return Number(m[1]);
}

function slotFromOpportunity(opportunity) {
  if (!opportunity) return null;
  const dateOnly = calendarDay(opportunity.start_date);
  const weekday = weekdayFromDateOnly(dateOnly);
  if (!weekday) return null;
  const hour = hourFromTimestamp(opportunity.start_date);
  const part_of_day = partOfDayFromHour(hour == null ? 9 : hour);
  return {
    weekday,
    part_of_day,
    date: dateOnly,
    weekday_label: WEEKDAY_LABELS[weekday],
    part_label: PART_LABELS[part_of_day],
  };
}

function displayName(row) {
  if (!row) return null;
  const fromParts = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return fromParts || row.name || null;
}

function mapSlot(row) {
  return {
    weekday: row.weekday,
    part_of_day: row.part_of_day,
    weekday_label: WEEKDAY_LABELS[row.weekday] || row.weekday,
    part_label: PART_LABELS[row.part_of_day] || row.part_of_day,
  };
}

function parseSlots(input) {
  const list = Array.isArray(input) ? input : [];
  const seen = new Set();
  const slots = [];
  for (const item of list) {
    const weekday = normaliseWeekday(item?.weekday ?? item?.day);
    const part_of_day = normalisePart(item?.part_of_day ?? item?.partOfDay ?? item?.part);
    if (!weekday || !part_of_day) {
      throw fail(400, 'Each slot needs a weekday and part of day (morning, afternoon, or evening).');
    }
    const key = `${weekday}:${part_of_day}`;
    if (seen.has(key)) continue;
    seen.add(key);
    slots.push({ weekday, part_of_day });
  }
  if (slots.length > 21) {
    throw fail(400, 'Too many availability slots.');
  }
  return slots;
}

async function listForUser(userId) {
  requireShelterId();
  const id = Number(userId);
  if (!Number.isInteger(id) || id < 1) throw fail(400, 'Invalid user');

  const [rows] = await pool.execute(
    `SELECT weekday, part_of_day
       FROM volunteer_usual_availability
      WHERE user_id = ?
      ORDER BY
        CASE weekday
          WHEN 'mon' THEN 1 WHEN 'tue' THEN 2 WHEN 'wed' THEN 3
          WHEN 'thu' THEN 4 WHEN 'fri' THEN 5 WHEN 'sat' THEN 6
          ELSE 7
        END,
        CASE part_of_day
          WHEN 'morning' THEN 1 WHEN 'afternoon' THEN 2 ELSE 3
        END`,
    [id]
  );
  return {
    user_id: id,
    slots: rows.map(mapSlot),
  };
}

async function replaceForUser(userId, slotsInput) {
  requireShelterId();
  const id = Number(userId);
  if (!Number.isInteger(id) || id < 1) throw fail(400, 'Invalid user');

  const [users] = await pool.execute(
    `SELECT user_id, role, archived_at, anonymised_at
       FROM users
      WHERE user_id = ?
      LIMIT 1`,
    [id]
  );
  const user = users[0];
  if (!user || user.role !== 'volunteer') {
    throw fail(404, 'Volunteer not found');
  }
  if (user.archived_at || user.anonymised_at) {
    throw fail(404, 'Volunteer not found');
  }

  const slots = parseSlots(slotsInput);
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`DELETE FROM volunteer_usual_availability WHERE user_id = ?`, [id]);
    for (const slot of slots) {
      await conn.execute(
        `INSERT INTO volunteer_usual_availability (user_id, weekday, part_of_day)
         VALUES (?, ?, ?)`,
        [id, slot.weekday, slot.part_of_day]
      );
    }
    await conn.commit();
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {
      /* ignore */
    }
    throw error;
  } finally {
    conn.release();
  }

  return listForUser(id);
}

async function findOpportunity(opportunityId) {
  requireShelterId();
  const id = Number(opportunityId);
  if (!Number.isInteger(id) || id < 1) throw fail(400, 'Invalid shift');

  const [rows] = await pool.execute(
    `SELECT
       o.opportunity_id,
       o.title,
       o.location,
       o.start_date,
       o.end_date,
       o.max_volunteers,
       o.status,
       (
         (
           SELECT COUNT(*)
           FROM applications a
           WHERE a.opportunity_id = o.opportunity_id
             AND a.status IN ('accepted', 'approved')
         )
         +
         (
           SELECT COALESCE(SUM(gb.size), 0)
           FROM group_bookings gb
           WHERE gb.opportunity_id = o.opportunity_id
             AND gb.status = 'confirmed'
         )
       ) AS spots_filled
     FROM opportunities o
     WHERE o.opportunity_id = ?
     LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;
  return {
    ...row,
    spots_filled: Number(row.spots_filled) || 0,
    max_volunteers:
      row.max_volunteers == null || row.max_volunteers === ''
        ? null
        : Number(row.max_volunteers),
  };
}

function isShortStaffed(opportunity) {
  if (!opportunity) return false;
  if (opportunity.max_volunteers == null) {
    return opportunity.spots_filled === 0;
  }
  return opportunity.spots_filled < opportunity.max_volunteers;
}

/**
 * Approved volunteers in this shelter who marked the same weekday + part of day,
 * not already booked on the shift, and not currently away.
 */
async function listMatchesForOpportunity(opportunityId) {
  const opportunity = await findOpportunity(opportunityId);
  if (!opportunity) throw fail(404, 'Shift not found');

  const slot = slotFromOpportunity(opportunity);
  if (!slot) throw fail(400, 'This shift has no start time to match against.');

  const shortStaffed = isShortStaffed(opportunity);
  const today = todayIso();

  const [rows] = await pool.execute(
    `SELECT
       u.user_id,
       u.first_name,
       u.last_name,
       u.name,
       u.email,
       u.phone,
       vp.away_until
     FROM volunteer_usual_availability vua
     INNER JOIN users u ON u.user_id = vua.user_id
     INNER JOIN volunteer_profiles vp ON vp.user_id = u.user_id
     WHERE vua.weekday = ?
       AND vua.part_of_day = ?
       AND u.role = 'volunteer'
       AND u.archived_at IS NULL
       AND u.anonymised_at IS NULL
       AND vp.approved = 1
       AND (vp.away_until IS NULL OR vp.away_until::date < ?::date)
       AND NOT EXISTS (
         SELECT 1
         FROM applications a
         WHERE a.opportunity_id = ?
           AND a.user_id = u.user_id
           AND a.status IN ('accepted', 'approved', 'pending')
       )
     ORDER BY u.last_name ASC NULLS LAST, u.first_name ASC NULLS LAST, u.user_id ASC`,
    [slot.weekday, slot.part_of_day, today, opportunity.opportunity_id]
  );

  return {
    opportunity: {
      opportunity_id: Number(opportunity.opportunity_id),
      title: opportunity.title || 'Shift',
      location: opportunity.location || null,
      start_date: opportunity.start_date,
      end_date: opportunity.end_date,
      spots_filled: opportunity.spots_filled,
      max_volunteers: opportunity.max_volunteers,
      short_staffed: shortStaffed,
    },
    match: slot,
    volunteers: rows.map((row) => ({
      user_id: Number(row.user_id),
      name: displayName(row),
      first_name: row.first_name || null,
      email: row.email || null,
      phone: row.phone || null,
    })),
  };
}

async function findMatchVolunteer(opportunityId, userId) {
  const summary = await listMatchesForOpportunity(opportunityId);
  const id = Number(userId);
  const volunteer = summary.volunteers.find((v) => v.user_id === id);
  if (!volunteer) {
    throw fail(404, 'That volunteer is not usually available for this shift.');
  }
  return { summary, volunteer };
}

module.exports = {
  WEEKDAYS,
  PARTS,
  WEEKDAY_LABELS,
  PART_LABELS,
  normaliseWeekday,
  normalisePart,
  partOfDayFromHour,
  weekdayFromDateOnly,
  slotFromOpportunity,
  parseSlots,
  listForUser,
  replaceForUser,
  findOpportunity,
  isShortStaffed,
  listMatchesForOpportunity,
  findMatchVolunteer,
};
