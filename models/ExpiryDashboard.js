'use strict';

/**
 * Staff document / check / qualification expiry dashboard (SL-DAY-12).
 * Lists rows with an expiry date in the next N days (default 30).
 * Optional staff-triggered email reminders only (no SMS, never automatic).
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');

const DEFAULT_DAYS = 30;
const MAX_DAYS = 90;
const KINDS = new Set(['background_check', 'document', 'qualification']);

const CHECK_TYPE_LABELS = {
  accessni_basic: 'AccessNI Basic',
  accessni_standard: 'AccessNI Standard',
  accessni_enhanced: 'AccessNI Enhanced',
  other: 'Other check',
};

function requireShelterId() {
  const id = currentShelterId();
  if (!id) {
    const err = new Error('Shelter context required');
    err.status = 403;
    throw err;
  }
  return id;
}

function clampDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n)) return DEFAULT_DAYS;
  return Math.min(Math.max(Math.trunc(n), 1), MAX_DAYS);
}

function volunteerName(row) {
  return (
    `${row.first_name || ''} ${row.last_name || ''}`.trim() ||
    row.name ||
    row.email ||
    `Volunteer #${row.user_id}`
  );
}

function checkLabel(checkType) {
  return CHECK_TYPE_LABELS[checkType] || String(checkType || 'Background check').replace(/_/g, ' ');
}

function addDaysIso(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + Number(days));
  return d.toISOString().slice(0, 10);
}

function todayIso(now = new Date()) {
  return String(now.toISOString()).slice(0, 10);
}

function mapItem(kind, row, label, expiresOn) {
  return {
    kind,
    id: Number(row.id),
    user_id: Number(row.user_id),
    volunteer_name: volunteerName(row),
    label,
    expires_on: expiresOn ? String(expiresOn).slice(0, 10) : null,
    status: row.status || null,
    last_staff_reminder_sent_at: row.last_staff_reminder_sent_at || null,
    href: `/pages/admin/volunteers.html?user=${encodeURIComponent(row.user_id)}`,
  };
}

/**
 * Unified list of expiring background checks, documents, and qualifications.
 */
async function listExpiring({ days = DEFAULT_DAYS, now = new Date() } = {}) {
  requireShelterId();
  const dayCount = clampDays(days);
  const today = todayIso(now);
  const until = addDaysIso(today, dayCount);

  const [checks] = await pool.execute(
    `
      SELECT
        bc.id,
        bc.user_id,
        bc.check_type,
        bc.status,
        bc.expires_on,
        bc.last_staff_reminder_sent_at,
        u.first_name,
        u.last_name,
        u.name,
        u.email
      FROM background_checks bc
      INNER JOIN users u ON u.user_id = bc.user_id
      WHERE bc.expires_on IS NOT NULL
        AND bc.expires_on >= ?::date
        AND bc.expires_on <= ?::date
        AND bc.status IN ('clear', 'pending', 'requested', 'expired')
        AND u.archived_at IS NULL
        AND u.anonymised_at IS NULL
      ORDER BY bc.expires_on ASC, bc.id ASC
    `,
    [today, until]
  );

  const [documents] = await pool.execute(
    `
      SELECT
        d.id,
        d.user_id,
        d.label,
        d.original_name,
        d.expires_at,
        d.last_staff_reminder_sent_at,
        u.first_name,
        u.last_name,
        u.name,
        u.email
      FROM user_documents d
      INNER JOIN users u ON u.user_id = d.user_id
      WHERE d.expires_at IS NOT NULL
        AND d.expires_at >= ?::date
        AND d.expires_at <= ?::date
        AND u.archived_at IS NULL
        AND u.anonymised_at IS NULL
      ORDER BY d.expires_at ASC, d.id ASC
    `,
    [today, until]
  );

  const [quals] = await pool.execute(
    `
      SELECT
        vq.id,
        vq.user_id,
        vq.expires_at,
        vq.last_staff_reminder_sent_at,
        q.name AS qualification_name,
        u.first_name,
        u.last_name,
        u.name,
        u.email
      FROM volunteer_qualifications vq
      INNER JOIN qualifications q ON q.id = vq.qualification_id
      INNER JOIN users u ON u.user_id = vq.user_id
      WHERE vq.expires_at IS NOT NULL
        AND vq.expires_at >= ?::date
        AND vq.expires_at <= ?::date
        AND u.archived_at IS NULL
        AND u.anonymised_at IS NULL
      ORDER BY vq.expires_at ASC, vq.id ASC
    `,
    [today, until]
  );

  const items = [
    ...(Array.isArray(checks) ? checks : []).map((row) =>
      mapItem('background_check', row, checkLabel(row.check_type), row.expires_on)
    ),
    ...(Array.isArray(documents) ? documents : []).map((row) =>
      mapItem(
        'document',
        row,
        row.label || row.original_name || 'Document',
        row.expires_at
      )
    ),
    ...(Array.isArray(quals) ? quals : []).map((row) =>
      mapItem(
        'qualification',
        row,
        row.qualification_name || 'Qualification',
        row.expires_at
      )
    ),
  ];

  items.sort((a, b) => {
    const byDate = String(a.expires_on).localeCompare(String(b.expires_on));
    if (byDate !== 0) return byDate;
    const byKind = String(a.kind).localeCompare(String(b.kind));
    if (byKind !== 0) return byKind;
    return Number(a.id) - Number(b.id);
  });

  return { days: dayCount, from: today, until, items };
}

/**
 * Load one expiring row with volunteer email for a staff reminder send.
 */
async function findForReminder(kind, id) {
  requireShelterId();
  if (!KINDS.has(kind)) {
    const err = new Error('Unknown expiry kind');
    err.status = 400;
    throw err;
  }
  const rowId = Number(id);
  if (!Number.isInteger(rowId) || rowId < 1) {
    const err = new Error('Invalid id');
    err.status = 400;
    throw err;
  }

  if (kind === 'background_check') {
    const [rows] = await pool.execute(
      `
        SELECT
          bc.id,
          bc.user_id,
          bc.check_type,
          bc.status,
          bc.expires_on AS expires_on,
          bc.last_staff_reminder_sent_at,
          u.first_name,
          u.last_name,
          u.name,
          u.email,
          u.archived_at,
          u.anonymised_at
        FROM background_checks bc
        INNER JOIN users u ON u.user_id = bc.user_id
        WHERE bc.id = ?
        LIMIT 1
      `,
      [rowId]
    );
    const row = rows && rows[0];
    if (!row) return null;
    if (row.archived_at || row.anonymised_at) return null;
    return {
      kind,
      id: Number(row.id),
      user_id: Number(row.user_id),
      email: row.email,
      volunteer_name: volunteerName(row),
      first_name: row.first_name || row.name || 'there',
      label: checkLabel(row.check_type),
      expires_on: row.expires_on ? String(row.expires_on).slice(0, 10) : null,
      last_staff_reminder_sent_at: row.last_staff_reminder_sent_at || null,
    };
  }

  if (kind === 'document') {
    const [rows] = await pool.execute(
      `
        SELECT
          d.id,
          d.user_id,
          d.label,
          d.original_name,
          d.expires_at AS expires_on,
          d.last_staff_reminder_sent_at,
          u.first_name,
          u.last_name,
          u.name,
          u.email,
          u.archived_at,
          u.anonymised_at
        FROM user_documents d
        INNER JOIN users u ON u.user_id = d.user_id
        WHERE d.id = ?
        LIMIT 1
      `,
      [rowId]
    );
    const row = rows && rows[0];
    if (!row) return null;
    if (row.archived_at || row.anonymised_at) return null;
    return {
      kind,
      id: Number(row.id),
      user_id: Number(row.user_id),
      email: row.email,
      volunteer_name: volunteerName(row),
      first_name: row.first_name || row.name || 'there',
      label: row.label || row.original_name || 'Document',
      expires_on: row.expires_on ? String(row.expires_on).slice(0, 10) : null,
      last_staff_reminder_sent_at: row.last_staff_reminder_sent_at || null,
    };
  }

  const [rows] = await pool.execute(
    `
      SELECT
        vq.id,
        vq.user_id,
        vq.expires_at AS expires_on,
        vq.last_staff_reminder_sent_at,
        q.name AS qualification_name,
        u.first_name,
        u.last_name,
        u.name,
        u.email,
        u.archived_at,
        u.anonymised_at
      FROM volunteer_qualifications vq
      INNER JOIN qualifications q ON q.id = vq.qualification_id
      INNER JOIN users u ON u.user_id = vq.user_id
      WHERE vq.id = ?
      LIMIT 1
    `,
    [rowId]
  );
  const row = rows && rows[0];
  if (!row) return null;
  if (row.archived_at || row.anonymised_at) return null;
  return {
    kind,
    id: Number(row.id),
    user_id: Number(row.user_id),
    email: row.email,
    volunteer_name: volunteerName(row),
    first_name: row.first_name || row.name || 'there',
    label: row.qualification_name || 'Qualification',
    expires_on: row.expires_on ? String(row.expires_on).slice(0, 10) : null,
    last_staff_reminder_sent_at: row.last_staff_reminder_sent_at || null,
  };
}

async function markReminderSent(kind, id, when = new Date()) {
  requireShelterId();
  if (!KINDS.has(kind)) {
    const err = new Error('Unknown expiry kind');
    err.status = 400;
    throw err;
  }
  const rowId = Number(id);
  if (!Number.isInteger(rowId) || rowId < 1) {
    const err = new Error('Invalid id');
    err.status = 400;
    throw err;
  }

  const table =
    kind === 'background_check'
      ? 'background_checks'
      : kind === 'document'
        ? 'user_documents'
        : 'volunteer_qualifications';

  const [result] = await pool.execute(
    `UPDATE ${table} SET last_staff_reminder_sent_at = ? WHERE id = ?`,
    [when, rowId]
  );
  return Number(result?.affectedRows) > 0;
}

module.exports = {
  DEFAULT_DAYS,
  MAX_DAYS,
  KINDS,
  CHECK_TYPE_LABELS,
  clampDays,
  listExpiring,
  findForReminder,
  markReminderSent,
};
