'use strict';

const { pool } = require('../config/database');

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function isValidDateOnly(value) {
  if (!value || !DATE_RE.test(String(value))) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

function addDays(dateOnly, days) {
  const d = new Date(`${dateOnly}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Monday check using noon UTC to avoid DST edge cases. */
function isMonday(dateOnly) {
  if (!isValidDateOnly(dateOnly)) return false;
  const d = new Date(`${dateOnly}T12:00:00Z`);
  return d.getUTCDay() === 1;
}

function dateOnlyFromTimestamp(value) {
  if (!value) return null;
  const s = String(value);
  if (DATE_RE.test(s.slice(0, 10))) return s.slice(0, 10);
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

/**
 * Roster for a calendar day range (inclusive): opportunities + accepted
 * volunteers + waitlist counts. Emergency contact / phone are intentional —
 * staff-only day/week sheet use.
 */
async function getForDateRange(startDate, endDate) {
  if (!isValidDateOnly(startDate) || !isValidDateOnly(endDate)) {
    throw new Error('date must be YYYY-MM-DD');
  }
  if (startDate > endDate) {
    throw new Error('start date must be on or before end date');
  }

  const [opportunities] = await pool.execute(
    `
      SELECT
        o.opportunity_id,
        o.title,
        o.location,
        o.start_date,
        o.end_date,
        o.check_in_code,
        o.max_volunteers,
        o.status,
        o.is_urgent,
        o.activity_notes,
        (
          SELECT COUNT(*)
          FROM applications a
          WHERE a.opportunity_id = o.opportunity_id
            AND a.status = 'waitlisted'
        ) AS waitlist_count
      FROM opportunities o
      WHERE o.start_date::date >= ?::date
        AND o.start_date::date <= ?::date
        AND o.status IN ('open', 'closed', 'completed')
      ORDER BY o.start_date ASC, o.opportunity_id ASC
    `,
    [startDate, endDate]
  );

  if (!opportunities.length) {
    return { start_date: startDate, end_date: endDate, opportunities: [] };
  }

  const ids = opportunities.map((o) => o.opportunity_id);
  const placeholders = ids.map(() => '?').join(', ');

  const [volunteers] = await pool.execute(
    `
      SELECT
        a.application_id,
        a.opportunity_id,
        a.status,
        a.checked_in_at,
        a.checked_out_at,
        a.no_show,
        u.user_id,
        u.first_name,
        u.last_name,
        u.phone,
        vp.emergency_contact
      FROM applications a
      INNER JOIN users u ON u.user_id = a.user_id
      LEFT JOIN volunteer_profiles vp ON vp.user_id = u.user_id
      WHERE a.opportunity_id IN (${placeholders})
        AND a.status IN ('accepted', 'approved')
      ORDER BY u.last_name ASC, u.first_name ASC
    `,
    ids
  );

  const [requiredQuals] = await pool.execute(
    `
      SELECT
        oq.opportunity_id,
        q.id AS qualification_id,
        q.name AS qualification_name
      FROM opportunity_qualifications oq
      INNER JOIN qualifications q ON q.id = oq.qualification_id
      WHERE oq.opportunity_id IN (${placeholders})
      ORDER BY q.name ASC
    `,
    ids
  );

  const userIds = [...new Set(volunteers.map((v) => v.user_id))];
  let awards = [];
  if (userIds.length) {
    const uPlaceholders = userIds.map(() => '?').join(', ');
    const [rows] = await pool.execute(
      `
        SELECT user_id, qualification_id, expires_at
        FROM volunteer_qualifications
        WHERE user_id IN (${uPlaceholders})
      `,
      userIds
    );
    awards = rows;
  }

  const [animals] = await pool.execute(
    `
      SELECT
        oa.opportunity_id,
        a.id AS animal_id,
        a.name,
        a.species,
        a.kennel_ref,
        a.handling_notes,
        a.photo_filename
      FROM opportunity_animals oa
      INNER JOIN animals a ON a.id = oa.animal_id
      WHERE oa.opportunity_id IN (${placeholders})
      ORDER BY a.name ASC
    `,
    ids
  );

  const [shiftNotes] = await pool.execute(
    `
      SELECT
        sn.id,
        sn.opportunity_id,
        sn.author_id,
        sn.body,
        sn.notify,
        sn.created_at,
        u.first_name AS author_first_name,
        u.last_name AS author_last_name,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS author_name
      FROM shift_notes sn
      LEFT JOIN users u ON u.user_id = sn.author_id
      WHERE sn.opportunity_id IN (${placeholders})
      ORDER BY sn.created_at DESC, sn.id DESC
    `,
    ids
  );

  const qualsByOpp = new Map();
  for (const q of requiredQuals) {
    const list = qualsByOpp.get(q.opportunity_id) || [];
    list.push({ id: q.qualification_id, name: q.qualification_name });
    qualsByOpp.set(q.opportunity_id, list);
  }

  const awardsByUser = new Map();
  for (const a of awards) {
    const list = awardsByUser.get(a.user_id) || [];
    list.push(a);
    awardsByUser.set(a.user_id, list);
  }

  const animalsByOpp = new Map();
  for (const a of animals) {
    const list = animalsByOpp.get(a.opportunity_id) || [];
    list.push({
      id: a.animal_id,
      name: a.name,
      species: a.species,
      kennel_ref: a.kennel_ref,
      handling_notes: a.handling_notes,
      photo_filename: a.photo_filename || null,
    });
    animalsByOpp.set(a.opportunity_id, list);
  }

  const notesByOpp = new Map();
  for (const n of shiftNotes) {
    const list = notesByOpp.get(n.opportunity_id) || [];
    list.push({
      id: n.id,
      opportunity_id: n.opportunity_id,
      author_id: n.author_id,
      body: n.body,
      notify: Number(n.notify) ? 1 : 0,
      created_at: n.created_at,
      author_name: n.author_name || null,
    });
    notesByOpp.set(n.opportunity_id, list);
  }

  const oppDateById = new Map();
  for (const o of opportunities) {
    oppDateById.set(o.opportunity_id, dateOnlyFromTimestamp(o.start_date) || startDate);
  }

  const volunteersByOpp = new Map();
  for (const v of volunteers) {
    const required = qualsByOpp.get(v.opportunity_id) || [];
    const held = awardsByUser.get(v.user_id) || [];
    const asOf = oppDateById.get(v.opportunity_id) || startDate;
    const heldIds = new Set(
      held
        .filter((h) => {
          if (!h.expires_at) return true;
          return String(h.expires_at).slice(0, 10) >= asOf;
        })
        .map((h) => Number(h.qualification_id))
    );
    const qualification_flags = required.map((q) => ({
      id: q.id,
      name: q.name,
      held: heldIds.has(Number(q.id)),
    }));

    let check_in_status = 'not_checked_in';
    if (v.no_show) check_in_status = 'no_show';
    else if (v.checked_out_at) check_in_status = 'checked_out';
    else if (v.checked_in_at) check_in_status = 'checked_in';

    const list = volunteersByOpp.get(v.opportunity_id) || [];
    list.push({
      application_id: v.application_id,
      user_id: v.user_id,
      first_name: v.first_name,
      last_name: v.last_name,
      name: `${v.first_name || ''} ${v.last_name || ''}`.trim(),
      phone: v.phone || null,
      emergency_contact: v.emergency_contact || null,
      check_in_status,
      checked_in_at: v.checked_in_at,
      qualification_flags,
    });
    volunteersByOpp.set(v.opportunity_id, list);
  }

  return {
    start_date: startDate,
    end_date: endDate,
    opportunities: opportunities.map((o) => ({
      id: o.opportunity_id,
      opportunity_id: o.opportunity_id,
      title: o.title,
      location: o.location,
      start_date: o.start_date,
      end_date: o.end_date,
      check_in_code: o.check_in_code,
      max_volunteers: o.max_volunteers,
      status: o.status,
      is_urgent: Boolean(Number(o.is_urgent)),
      activity_notes: o.activity_notes,
      waitlist_count: Number(o.waitlist_count) || 0,
      volunteers: volunteersByOpp.get(o.opportunity_id) || [],
      required_qualifications: qualsByOpp.get(o.opportunity_id) || [],
      animals: animalsByOpp.get(o.opportunity_id) || [],
      shift_notes: notesByOpp.get(o.opportunity_id) || [],
    })),
  };
}

/**
 * Roster for a calendar day: opportunities + accepted volunteers + waitlist counts.
 */
async function getForDate(dateOnly) {
  if (!isValidDateOnly(dateOnly)) {
    throw new Error('date must be YYYY-MM-DD');
  }
  const range = await getForDateRange(dateOnly, dateOnly);
  return { date: dateOnly, opportunities: range.opportunities };
}

/**
 * Staff week sheet: Monday–Sunday inclusive, grouped by day.
 */
async function getForWeek(weekStart) {
  if (!isValidDateOnly(weekStart)) {
    throw new Error('week_start must be YYYY-MM-DD');
  }
  if (!isMonday(weekStart)) {
    throw new Error('week_start must be a Monday');
  }
  const weekEnd = addDays(weekStart, 6);
  const range = await getForDateRange(weekStart, weekEnd);
  const days = [];
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(weekStart, i);
    days.push({
      date,
      opportunities: range.opportunities.filter(
        (o) => dateOnlyFromTimestamp(o.start_date) === date
      ),
    });
  }
  return {
    week_start: weekStart,
    week_end: weekEnd,
    days,
    opportunities: range.opportunities,
  };
}

module.exports = {
  getForDate,
  getForWeek,
  getForDateRange,
  isValidDateOnly,
  isMonday,
  addDays,
};
