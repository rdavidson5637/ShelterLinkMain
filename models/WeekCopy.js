'use strict';

/**
 * Copy a week of shifts (SL-LATER-31).
 *
 * Staff pick a source Monday and a target Monday. Each non-cancelled shift in
 * the source week is moved by the whole-week offset and becomes a new open
 * shift: title, description, requirements, location, times, capacity, linked
 * animals, required qualifications and background-check level are copied.
 * Bookings, waitlists, notes, urgent flags and check-in codes are not.
 *
 * A planned shift is skipped when the target week already has a live shift
 * with the same title starting at the same minute, or when an earlier row in
 * the same copy would create that pair.
 *
 * Tenant scope: every query runs under the caller's shelter context, so RLS
 * limits both weeks to that shelter. planCopy refuses to run without one.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');
const { generateCheckInCode } = require('./Opportunity');
const { isValidDateOnly, isMonday, addDays } = require('./DaySheet');

// One week of a busy shelter is well under this; the cap stops a runaway copy.
const MAX_SHIFTS = 300;

function fail(status, message) {
  const err = new Error(message);
  err.status = status;
  return err;
}

function requireShelter() {
  const id = currentShelterId();
  if (!id) throw fail(403, 'Shelter context is missing');
  return id;
}

function validateWeeks(sourceWeek, targetWeek, today) {
  for (const [label, value] of [
    ['source_week', sourceWeek],
    ['target_week', targetWeek],
  ]) {
    if (!isValidDateOnly(value)) throw fail(400, `${label} must be YYYY-MM-DD`);
    if (!isMonday(value)) throw fail(400, `${label} must be a Monday`);
  }
  if (sourceWeek === targetWeek) {
    throw fail(400, 'Source and target week must be different');
  }
  if (today && addDays(targetWeek, 6) < today) {
    throw fail(400, 'Target week has already ended');
  }
}

function dayOffset(sourceWeek, targetWeek) {
  const a = Date.parse(`${sourceWeek}T12:00:00Z`);
  const b = Date.parse(`${targetWeek}T12:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** Normalise a DB timestamp string to "YYYY-MM-DD HH:MM:SS". */
function normaliseTimestamp(value) {
  if (value == null || value === '') return null;
  const s = String(value).replace('T', ' ');
  const m = /^(\d{4}-\d{2}-\d{2})(?: (\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(s);
  if (!m) return null;
  const [, date, hh = '00', mm = '00', ss = '00'] = m;
  return `${date} ${hh}:${mm}:${ss}`;
}

/** Move a timestamp by whole days, keeping the wall-clock time. */
function shiftTimestamp(value, days) {
  const ts = normaliseTimestamp(value);
  if (!ts) return null;
  return `${addDays(ts.slice(0, 10), days)}${ts.slice(10)}`;
}

function duplicateKey(title, start) {
  const ts = normaliseTimestamp(start);
  return `${String(title || '').trim().toLowerCase()}|${ts ? ts.slice(0, 16) : ''}`;
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) {
    const k = Number(row[key]);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(row);
  }
  return map;
}

async function loadWeek(db, weekStart) {
  const [rows] = await db.execute(
    `
      SELECT
        o.opportunity_id,
        o.title,
        o.description,
        o.requirements,
        o.location,
        o.start_date,
        o.end_date,
        o.max_volunteers,
        o.cancellation_cutoff_hours,
        o.required_background_check_type
      FROM opportunities o
      WHERE o.start_date::date >= ?::date
        AND o.start_date::date <= ?::date
        AND o.status <> 'cancelled'
      ORDER BY o.start_date ASC, o.opportunity_id ASC
    `,
    [weekStart, addDays(weekStart, 6)]
  );
  return rows || [];
}

async function loadLinks(db, ids) {
  if (!ids.length) return { animals: new Map(), qualifications: new Map() };
  const placeholders = ids.map(() => '?').join(', ');
  const [animals] = await db.execute(
    `
      SELECT oa.opportunity_id, a.id AS animal_id, a.name
      FROM opportunity_animals oa
      INNER JOIN animals a ON a.id = oa.animal_id
      WHERE oa.opportunity_id IN (${placeholders})
      ORDER BY a.name ASC
    `,
    ids
  );
  const [quals] = await db.execute(
    `
      SELECT oq.opportunity_id, q.id AS qualification_id, q.name
      FROM opportunity_qualifications oq
      INNER JOIN qualifications q ON q.id = oq.qualification_id
      WHERE oq.opportunity_id IN (${placeholders})
      ORDER BY q.name ASC
    `,
    ids
  );
  return {
    animals: groupBy(animals || [], 'opportunity_id'),
    qualifications: groupBy(quals || [], 'opportunity_id'),
  };
}

async function buildPlan(db, sourceWeek, targetWeek) {
  const source = await loadWeek(db, sourceWeek);
  if (source.length > MAX_SHIFTS) {
    throw fail(400, `Source week has more than ${MAX_SHIFTS} shifts; copy it in parts`);
  }
  const target = await loadWeek(db, targetWeek);
  const links = await loadLinks(
    db,
    source.map((o) => o.opportunity_id)
  );

  const offset = dayOffset(sourceWeek, targetWeek);
  const existing = new Map(
    target.map((o) => [duplicateKey(o.title, o.start_date), o.opportunity_id])
  );
  const planned = new Set();

  const rows = source.map((o) => {
    const start = shiftTimestamp(o.start_date, offset);
    const end = shiftTimestamp(o.end_date, offset);
    const key = duplicateKey(o.title, start);
    let action = 'create';
    let reason = null;
    let existingId = null;
    if (existing.has(key)) {
      action = 'skip';
      reason = 'A shift with this title already starts at this time';
      existingId = existing.get(key);
    } else if (planned.has(key)) {
      action = 'skip';
      reason = 'Same title and time as an earlier row in this copy';
    }
    if (action === 'create') planned.add(key);

    const id = Number(o.opportunity_id);
    return {
      source_opportunity_id: id,
      title: o.title,
      description: o.description || null,
      requirements: o.requirements || null,
      location: o.location || null,
      source_start_date: normaliseTimestamp(o.start_date),
      start_date: start,
      end_date: end,
      max_volunteers: o.max_volunteers == null ? null : Number(o.max_volunteers),
      cancellation_cutoff_hours: o.cancellation_cutoff_hours,
      required_background_check_type: o.required_background_check_type || null,
      animals: (links.animals.get(id) || []).map((a) => ({
        id: Number(a.animal_id),
        name: a.name,
      })),
      qualifications: (links.qualifications.get(id) || []).map((q) => ({
        id: Number(q.qualification_id),
        name: q.name,
      })),
      action,
      skip_reason: reason,
      existing_opportunity_id: existingId == null ? null : Number(existingId),
    };
  });

  const toCreate = rows.filter((r) => r.action === 'create').length;
  return {
    source_week: sourceWeek,
    source_week_end: addDays(sourceWeek, 6),
    target_week: targetWeek,
    target_week_end: addDays(targetWeek, 6),
    rows,
    counts: {
      source: rows.length,
      create: toCreate,
      skip: rows.length - toCreate,
    },
  };
}

/** Read-only preview of what a copy would create and skip. */
async function planCopy(sourceWeek, targetWeek, { today = null } = {}) {
  requireShelter();
  validateWeeks(sourceWeek, targetWeek, today);
  return buildPlan(pool, sourceWeek, targetWeek);
}

/**
 * Re-plan inside one transaction and create the shifts the plan marks
 * "create". A per-shelter, per-target-week advisory lock stops two confirms
 * racing each other into duplicates.
 */
async function executeCopy(sourceWeek, targetWeek, { createdBy = null, today = null } = {}) {
  const shelterId = requireShelter();
  validateWeeks(sourceWeek, targetWeek, today);

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(`SELECT pg_advisory_xact_lock(hashtext(?))`, [
      `week-copy:${shelterId}:${targetWeek}`,
    ]);

    const plan = await buildPlan(conn, sourceWeek, targetWeek);
    const animalRows = [];
    const qualRows = [];

    for (const row of plan.rows) {
      if (row.action !== 'create') continue;
      const cutoff = Number(row.cancellation_cutoff_hours);
      const [result] = await conn.execute(
        `
          INSERT INTO opportunities
            (title, description, requirements, location, start_date, end_date, max_volunteers,
             status, created_by, recurrence_rule, check_in_code, cancellation_cutoff_hours,
             required_background_check_type)
          VALUES (?, ?, ?, ?, ?, ?, ?, 'open', ?, 'none', ?, ?, ?)
          RETURNING opportunity_id
        `,
        [
          row.title,
          row.description,
          row.requirements,
          row.location,
          row.start_date,
          row.end_date,
          row.max_volunteers,
          createdBy,
          generateCheckInCode(),
          Number.isFinite(cutoff) && cutoff >= 0 ? Math.floor(cutoff) : 24,
          row.required_background_check_type,
        ]
      );
      const newId = Number(result.insertId);
      row.opportunity_id = newId;
      for (const a of row.animals) animalRows.push([newId, a.id]);
      for (const q of row.qualifications) qualRows.push([newId, q.id]);
    }

    if (animalRows.length) {
      await conn.execute(
        `INSERT INTO opportunity_animals (opportunity_id, animal_id) VALUES ${animalRows
          .map(() => '(?, ?)')
          .join(', ')} ON CONFLICT (opportunity_id, animal_id) DO NOTHING`,
        animalRows.flat()
      );
    }
    if (qualRows.length) {
      await conn.execute(
        `INSERT INTO opportunity_qualifications (opportunity_id, qualification_id) VALUES ${qualRows
          .map(() => '(?, ?)')
          .join(', ')} ON CONFLICT (opportunity_id, qualification_id) DO NOTHING`,
        qualRows.flat()
      );
    }

    await conn.commit();
    return {
      ...plan,
      created: plan.rows
        .filter((r) => r.action === 'create')
        .map((r) => ({
          opportunity_id: r.opportunity_id,
          source_opportunity_id: r.source_opportunity_id,
          title: r.title,
          start_date: r.start_date,
        })),
    };
  } catch (error) {
    try {
      await conn.rollback();
    } catch {
      /* already aborted */
    }
    throw error;
  } finally {
    conn.release();
  }
}

module.exports = {
  planCopy,
  executeCopy,
  shiftTimestamp,
  duplicateKey,
  dayOffset,
  MAX_SHIFTS,
};
