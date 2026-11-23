'use strict';

/**
 * Volunteer anniversary and attendance milestones (SL-DAY-06).
 *
 * Kinds:
 *   anniversary_1y  account created at least one year ago
 *   shifts_50       50 or more attended shifts (all time)
 *
 * Attended matches Reliability: accepted/approved place, not a no-show, and
 * either checked in or with approved hours on that shift. No scores, no
 * public surface. Dedup lives in volunteer_milestone_emails.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');

const KINDS = Object.freeze(['anniversary_1y', 'shifts_50']);
const SHIFTS_THRESHOLD = 50;

const LABELS = Object.freeze({
  anniversary_1y: 'One year volunteering',
  shifts_50: '50 shifts attended',
});

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

function isKind(value) {
  return KINDS.includes(String(value || ''));
}

function labelFor(kind) {
  return LABELS[kind] || kind;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function toTimestamp(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function oneYearAgo(now = new Date()) {
  const d = new Date(now.getTime());
  d.setUTCFullYear(d.getUTCFullYear() - 1);
  return toTimestamp(d);
}

/** Same attended rule as models/Reliability.js, without a date window. */
function attendedCountSql() {
  return `
    SELECT
      a.user_id,
      COUNT(*)::int AS attended
    FROM applications a
    JOIN opportunities o ON o.opportunity_id = a.opportunity_id
    WHERE a.status IN ('accepted', 'approved')
      AND COALESCE(a.no_show, 0) = 0
      AND (
        a.checked_in_at IS NOT NULL
        OR EXISTS (
          SELECT 1 FROM volunteer_hours vh
          WHERE vh.user_id = a.user_id
            AND vh.opportunity_id = a.opportunity_id
            AND vh.approved = 1
        )
      )
    GROUP BY a.user_id
  `;
}

function mapVolunteer(row, kind, extra = {}) {
  const name =
    `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email || 'Volunteer';
  return {
    user_id: Number(row.user_id),
    first_name: row.first_name || null,
    last_name: row.last_name || null,
    email: row.email || null,
    name,
    kind,
    label: labelFor(kind),
    href: `/pages/admin/volunteers.html?user=${encodeURIComponent(row.user_id)}`,
    ...extra,
  };
}

async function findVolunteer(userId) {
  requireShelterId();
  const id = Number(userId);
  if (!Number.isInteger(id) || id < 1) throw fail(400, 'Invalid volunteer');
  const [rows] = await pool.execute(
    `SELECT u.user_id, u.first_name, u.last_name, u.email, u.role, u.created_at,
            u.anonymised_at, vp.approved
       FROM users u
       LEFT JOIN volunteer_profiles vp ON vp.user_id = u.user_id
      WHERE u.user_id = ?`,
    [id]
  );
  const row = rows[0];
  if (!row || row.role !== 'volunteer' || row.anonymised_at) {
    throw fail(404, 'Volunteer not found');
  }
  return row;
}

async function emailedKindsForUser(userId) {
  const [rows] = await pool.execute(
    `SELECT milestone_kind, emailed_at, emailed_by
       FROM volunteer_milestone_emails
      WHERE user_id = ?`,
    [Number(userId)]
  );
  const byKind = new Map();
  for (const row of rows || []) {
    byKind.set(row.milestone_kind, {
      emailed_at: row.emailed_at,
      emailed_by: row.emailed_by == null ? null : Number(row.emailed_by),
    });
  }
  return byKind;
}

async function attendedCountForUser(userId) {
  const [rows] = await pool.execute(
    `
      SELECT COUNT(*)::int AS attended
      FROM applications a
      JOIN opportunities o ON o.opportunity_id = a.opportunity_id
      WHERE a.user_id = ?
        AND a.status IN ('accepted', 'approved')
        AND COALESCE(a.no_show, 0) = 0
        AND (
          a.checked_in_at IS NOT NULL
          OR EXISTS (
            SELECT 1 FROM volunteer_hours vh
            WHERE vh.user_id = a.user_id
              AND vh.opportunity_id = a.opportunity_id
              AND vh.approved = 1
          )
        )
    `,
    [Number(userId)]
  );
  return Number(rows[0]?.attended) || 0;
}

/**
 * Pending and already-emailed milestones for one volunteer (staff profile).
 */
async function forVolunteer(userId, { now = new Date() } = {}) {
  const row = await findVolunteer(userId);
  const emailed = await emailedKindsForUser(row.user_id);
  const attended = await attendedCountForUser(row.user_id);
  const joinedAt = row.created_at;
  const anniversaryReached = joinedAt != null && new Date(joinedAt) <= new Date(oneYearAgo(now));

  const items = [];

  if (anniversaryReached) {
    const sent = emailed.get('anniversary_1y');
    items.push(
      mapVolunteer(row, 'anniversary_1y', {
        reached: true,
        joined_at: joinedAt,
        emailed: Boolean(sent),
        emailed_at: sent ? sent.emailed_at : null,
        pending: !sent,
      })
    );
  }

  if (attended >= SHIFTS_THRESHOLD) {
    const sent = emailed.get('shifts_50');
    items.push(
      mapVolunteer(row, 'shifts_50', {
        reached: true,
        attended,
        emailed: Boolean(sent),
        emailed_at: sent ? sent.emailed_at : null,
        pending: !sent,
      })
    );
  }

  return {
    user_id: Number(row.user_id),
    attended,
    joined_at: joinedAt,
    shifts_threshold: SHIFTS_THRESHOLD,
    items,
    pending: items.filter((i) => i.pending),
  };
}

/**
 * Shelter-wide list of milestones reached but not yet emailed.
 */
async function listPending({ now = new Date() } = {}) {
  requireShelterId();
  const cutoff = oneYearAgo(now);

  const [annivRows] = await pool.execute(
    `
      SELECT u.user_id, u.first_name, u.last_name, u.email, u.created_at
        FROM users u
       WHERE u.role = 'volunteer'
         AND u.anonymised_at IS NULL
         AND u.created_at <= CAST(? AS TIMESTAMP)
         AND NOT EXISTS (
           SELECT 1 FROM volunteer_milestone_emails m
            WHERE m.user_id = u.user_id
              AND m.milestone_kind = 'anniversary_1y'
         )
       ORDER BY u.created_at ASC, u.user_id ASC
    `,
    [cutoff]
  );

  const [shiftRows] = await pool.execute(
    `
      SELECT u.user_id, u.first_name, u.last_name, u.email, c.attended
        FROM (${attendedCountSql()}) c
        JOIN users u ON u.user_id = c.user_id
       WHERE u.role = 'volunteer'
         AND u.anonymised_at IS NULL
         AND c.attended >= ?
         AND NOT EXISTS (
           SELECT 1 FROM volunteer_milestone_emails m
            WHERE m.user_id = u.user_id
              AND m.milestone_kind = 'shifts_50'
         )
       ORDER BY c.attended DESC, u.user_id ASC
    `,
    [SHIFTS_THRESHOLD]
  );

  const pending = [];
  for (const row of annivRows || []) {
    pending.push(
      mapVolunteer(row, 'anniversary_1y', {
        pending: true,
        joined_at: row.created_at,
        detail: 'One year since they joined',
      })
    );
  }
  for (const row of shiftRows || []) {
    pending.push(
      mapVolunteer(row, 'shifts_50', {
        pending: true,
        attended: Number(row.attended) || 0,
        detail: `${Number(row.attended) || 0} shifts attended`,
      })
    );
  }

  return {
    pending,
    counts: {
      pending: pending.length,
      anniversary_1y: (annivRows || []).length,
      shifts_50: (shiftRows || []).length,
    },
  };
}

async function alreadyEmailed(userId, kind) {
  const [rows] = await pool.execute(
    `SELECT id, emailed_at FROM volunteer_milestone_emails
      WHERE user_id = ? AND milestone_kind = ?`,
    [Number(userId), kind]
  );
  return rows[0] || null;
}

/**
 * Record that a milestone thank-you was sent. Unique (user_id, kind) is the
 * dedup guard — a second insert returns null.
 */
async function recordEmail(userId, kind, emailedBy) {
  requireShelterId();
  if (!isKind(kind)) throw fail(400, 'Unknown milestone');
  try {
    const [result] = await pool.execute(
      `INSERT INTO volunteer_milestone_emails (user_id, milestone_kind, emailed_by)
       VALUES (?, ?, ?)`,
      [Number(userId), kind, emailedBy == null ? null : Number(emailedBy)]
    );
    if (!result || result.insertId == null) return null;
    return { id: Number(result.insertId), emailed_at: null };
  } catch (error) {
    if (error && (error.code === '23505' || /unique/i.test(String(error.message || '')))) {
      return null;
    }
    throw error;
  }
}

/**
 * Confirm the volunteer has reached this milestone and it is still pending.
 */
async function assertReachable(userId, kind, { now = new Date() } = {}) {
  if (!isKind(kind)) throw fail(400, 'Unknown milestone');
  const summary = await forVolunteer(userId, { now });
  const item = summary.items.find((i) => i.kind === kind);
  if (!item) throw fail(404, 'This volunteer has not reached that milestone yet');
  if (item.emailed) {
    const err = fail(409, 'A thank-you for this milestone was already sent');
    err.emailed_at = item.emailed_at;
    throw err;
  }
  return { volunteer: await findVolunteer(userId), item, summary };
}

module.exports = {
  KINDS,
  SHIFTS_THRESHOLD,
  LABELS,
  isKind,
  labelFor,
  oneYearAgo,
  forVolunteer,
  listPending,
  alreadyEmailed,
  recordEmail,
  assertReachable,
  findVolunteer,
  attendedCountForUser,
};
