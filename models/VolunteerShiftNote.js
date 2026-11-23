'use strict';

/**
 * Optional after-shift notes from volunteers (SL-DAY-11).
 * Short text only — not a rating. One note per application. Allowed after
 * check-in (attended) or after the shift end time.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');

const TABLE = 'volunteer_shift_notes';
const MAX_BODY = 500;

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

function mapNote(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    application_id: Number(row.application_id),
    user_id: Number(row.user_id),
    opportunity_id: Number(row.opportunity_id),
    body: row.body || '',
    notify: Number(row.notify) ? 1 : 0,
    notify_emailed_at: row.notify_emailed_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    volunteer_name:
      row.volunteer_name ||
      [row.first_name, row.last_name].filter(Boolean).join(' ').trim() ||
      null,
    first_name: row.first_name || null,
    last_name: row.last_name || null,
    opportunity_title: row.opportunity_title || null,
    opportunity_start_date: row.opportunity_start_date || null,
    opportunity_end_date: row.opportunity_end_date || null,
    checked_in_at: row.checked_in_at || null,
    can_note: row.can_note != null ? Boolean(row.can_note) : undefined,
    has_note: row.has_note != null ? Boolean(row.has_note) : undefined,
  };
}

function normaliseBody(body) {
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw fail(400, 'Note text is required');
  if (text.length > MAX_BODY) {
    throw fail(400, `Note must be ${MAX_BODY} characters or fewer`);
  }
  return text;
}

/** Eligible once checked in (attended) or the shift end has passed. */
function eligibilitySql(aliasA = 'a', aliasO = 'o') {
  return `
    ${aliasA}.status IN ('accepted', 'approved')
    AND COALESCE(${aliasA}.no_show, 0) = 0
    AND (
      ${aliasA}.checked_in_at IS NOT NULL
      OR ${aliasA}.checked_out_at IS NOT NULL
      OR (
        ${aliasO}.end_date IS NOT NULL
        AND ${aliasO}.end_date <= CURRENT_TIMESTAMP
      )
      OR (
        ${aliasO}.end_date IS NULL
        AND ${aliasO}.start_date IS NOT NULL
        AND ${aliasO}.start_date <= CURRENT_TIMESTAMP
      )
    )
  `;
}

async function findById(noteId) {
  requireShelterId();
  const id = Number(noteId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const [rows] = await pool.execute(
    `
      SELECT
        n.id,
        n.application_id,
        n.user_id,
        n.opportunity_id,
        n.body,
        n.notify,
        n.notify_emailed_at,
        n.created_at,
        n.updated_at,
        u.first_name,
        u.last_name,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS volunteer_name,
        o.title AS opportunity_title,
        o.start_date AS opportunity_start_date,
        o.end_date AS opportunity_end_date
      FROM ${TABLE} n
      JOIN users u ON u.user_id = n.user_id
      JOIN opportunities o ON o.opportunity_id = n.opportunity_id
      WHERE n.id = ?
      LIMIT 1
    `,
    [id]
  );
  return mapNote(rows[0] || null);
}

async function findByApplicationId(applicationId) {
  requireShelterId();
  const id = Number(applicationId);
  if (!Number.isFinite(id) || id <= 0) return null;
  const [rows] = await pool.execute(
    `
      SELECT
        n.id,
        n.application_id,
        n.user_id,
        n.opportunity_id,
        n.body,
        n.notify,
        n.notify_emailed_at,
        n.created_at,
        n.updated_at,
        u.first_name,
        u.last_name,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS volunteer_name,
        o.title AS opportunity_title,
        o.start_date AS opportunity_start_date,
        o.end_date AS opportunity_end_date
      FROM ${TABLE} n
      JOIN users u ON u.user_id = n.user_id
      JOIN opportunities o ON o.opportunity_id = n.opportunity_id
      WHERE n.application_id = ?
      LIMIT 1
    `,
    [id]
  );
  return mapNote(rows[0] || null);
}

async function findByOpportunityId(opportunityId) {
  requireShelterId();
  const id = Number(opportunityId);
  if (!Number.isFinite(id) || id <= 0) return [];
  const [rows] = await pool.execute(
    `
      SELECT
        n.id,
        n.application_id,
        n.user_id,
        n.opportunity_id,
        n.body,
        n.notify,
        n.notify_emailed_at,
        n.created_at,
        n.updated_at,
        u.first_name,
        u.last_name,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS volunteer_name,
        o.title AS opportunity_title,
        o.start_date AS opportunity_start_date,
        o.end_date AS opportunity_end_date
      FROM ${TABLE} n
      JOIN users u ON u.user_id = n.user_id
      JOIN opportunities o ON o.opportunity_id = n.opportunity_id
      WHERE n.opportunity_id = ?
      ORDER BY n.created_at DESC, n.id DESC
    `,
    [id]
  );
  return rows.map(mapNote);
}

async function findByUserId(userId) {
  requireShelterId();
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return [];

  // RLS on users: missing row means this volunteer is not in the current shelter.
  const [userRows] = await pool.execute(
    `SELECT user_id FROM users WHERE user_id = ? AND role = 'volunteer' LIMIT 1`,
    [id]
  );
  if (!userRows[0]) {
    throw fail(404, 'Volunteer not found');
  }

  const [rows] = await pool.execute(
    `
      SELECT
        n.id,
        n.application_id,
        n.user_id,
        n.opportunity_id,
        n.body,
        n.notify,
        n.notify_emailed_at,
        n.created_at,
        n.updated_at,
        u.first_name,
        u.last_name,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS volunteer_name,
        o.title AS opportunity_title,
        o.start_date AS opportunity_start_date,
        o.end_date AS opportunity_end_date
      FROM ${TABLE} n
      JOIN users u ON u.user_id = n.user_id
      JOIN opportunities o ON o.opportunity_id = n.opportunity_id
      WHERE n.user_id = ?
      ORDER BY n.created_at DESC, n.id DESC
    `,
    [id]
  );
  return rows.map(mapNote);
}

/**
 * Past / eligible shifts for the volunteer, with any existing note.
 */
async function listEligibleForUser(userId) {
  requireShelterId();
  const id = Number(userId);
  if (!Number.isFinite(id) || id <= 0) return [];

  const [rows] = await pool.execute(
    `
      SELECT
        a.application_id,
        a.user_id,
        a.opportunity_id,
        a.checked_in_at,
        a.checked_out_at,
        o.title AS opportunity_title,
        o.start_date AS opportunity_start_date,
        o.end_date AS opportunity_end_date,
        n.id,
        n.body,
        n.notify,
        n.notify_emailed_at,
        n.created_at,
        n.updated_at,
        CASE WHEN (${eligibilitySql('a', 'o')}) THEN 1 ELSE 0 END AS can_note,
        CASE WHEN n.id IS NOT NULL THEN 1 ELSE 0 END AS has_note
      FROM applications a
      JOIN opportunities o ON o.opportunity_id = a.opportunity_id
      LEFT JOIN ${TABLE} n ON n.application_id = a.application_id
      WHERE a.user_id = ?
        AND a.status IN ('accepted', 'approved')
        AND COALESCE(a.no_show, 0) = 0
        AND (
          a.checked_in_at IS NOT NULL
          OR a.checked_out_at IS NOT NULL
          OR (o.end_date IS NOT NULL AND o.end_date <= CURRENT_TIMESTAMP)
          OR (o.end_date IS NULL AND o.start_date IS NOT NULL AND o.start_date <= CURRENT_TIMESTAMP)
        )
      ORDER BY o.start_date DESC, a.application_id DESC
      LIMIT 50
    `,
    [id]
  );

  return rows.map((row) => ({
    application_id: Number(row.application_id),
    opportunity_id: Number(row.opportunity_id),
    opportunity_title: row.opportunity_title || null,
    opportunity_start_date: row.opportunity_start_date || null,
    opportunity_end_date: row.opportunity_end_date || null,
    checked_in_at: row.checked_in_at || null,
    can_note: Boolean(Number(row.can_note)),
    has_note: Boolean(Number(row.has_note)),
    note: row.id
      ? {
          id: Number(row.id),
          body: row.body || '',
          notify: Number(row.notify) ? 1 : 0,
          notify_emailed_at: row.notify_emailed_at || null,
          created_at: row.created_at || null,
          updated_at: row.updated_at || null,
        }
      : null,
  }));
}

async function assertEligibleApplication(applicationId, userId) {
  requireShelterId();
  const appId = Number(applicationId);
  const uid = Number(userId);
  if (!Number.isFinite(appId) || appId <= 0) throw fail(400, 'Invalid application id');
  if (!Number.isFinite(uid) || uid <= 0) throw fail(400, 'Invalid user id');

  const [rows] = await pool.execute(
    `
      SELECT
        a.application_id,
        a.user_id,
        a.opportunity_id,
        a.status,
        a.no_show,
        a.checked_in_at,
        a.checked_out_at,
        o.title AS opportunity_title,
        o.start_date AS opportunity_start_date,
        o.end_date AS opportunity_end_date,
        CASE WHEN (${eligibilitySql('a', 'o')}) THEN 1 ELSE 0 END AS can_note
      FROM applications a
      JOIN opportunities o ON o.opportunity_id = a.opportunity_id
      WHERE a.application_id = ?
      LIMIT 1
    `,
    [appId]
  );
  const row = rows[0];
  if (!row) throw fail(404, 'Application not found');
  if (Number(row.user_id) !== uid) throw fail(403, 'Forbidden');
  if (!Number(row.can_note)) {
    throw fail(
      400,
      'You can leave a note after you are marked attended or after the shift ends'
    );
  }
  return row;
}

async function createOrUpdate({ applicationId, userId, body, notify = 0 } = {}) {
  requireShelterId();
  const text = normaliseBody(body);
  const notifyFlag = notify ? 1 : 0;
  const app = await assertEligibleApplication(applicationId, userId);

  const existing = await findByApplicationId(app.application_id);
  if (existing) {
    await pool.execute(
      `
        UPDATE ${TABLE}
           SET body = ?,
               notify = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE application_id = ?
      `,
      [text, notifyFlag, Number(app.application_id)]
    );
    return findByApplicationId(app.application_id);
  }

  const [result] = await pool.execute(
    `
      INSERT INTO ${TABLE} (
        application_id, user_id, opportunity_id, body, notify
      ) VALUES (?, ?, ?, ?, ?)
    `,
    [
      Number(app.application_id),
      Number(app.user_id),
      Number(app.opportunity_id),
      text,
      notifyFlag,
    ]
  );

  return findById(result.insertId);
}

async function markNotifyEmailed(noteId) {
  requireShelterId();
  const id = Number(noteId);
  if (!Number.isFinite(id) || id <= 0) return false;
  const [result] = await pool.execute(
    `
      UPDATE ${TABLE}
         SET notify_emailed_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND notify_emailed_at IS NULL
    `,
    [id]
  );
  return Number(result.affectedRows) > 0;
}

async function findStaffEmails() {
  requireShelterId();
  const [rows] = await pool.execute(
    `
      SELECT email
        FROM users
       WHERE role IN ('admin', 'staff')
         AND email IS NOT NULL
         AND email <> ''
         AND archived_at IS NULL
         AND anonymised_at IS NULL
    `
  );
  return rows.map((r) => r.email).filter(Boolean);
}

module.exports = {
  MAX_BODY,
  findById,
  findByApplicationId,
  findByOpportunityId,
  findByUserId,
  listEligibleForUser,
  assertEligibleApplication,
  createOrUpdate,
  markNotifyEmailed,
  findStaffEmails,
};
