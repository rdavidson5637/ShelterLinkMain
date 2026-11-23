'use strict';

/**
 * Shelter announcements for volunteers (SL-DAY-17).
 * Staff post short dated notices; volunteers see active ones on home.
 * Optional email to approved volunteers only on an explicit staff click.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');

const TITLE_MAX = 160;
const BODY_MAX = 2000;

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

function normaliseId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw fail(400, `Invalid ${label}`);
  }
  return id;
}

function normaliseTitle(raw) {
  const title = String(raw == null ? '' : raw).trim();
  if (!title) throw fail(400, 'Add a short title.');
  if (title.length > TITLE_MAX) {
    throw fail(400, `Title must be ${TITLE_MAX} characters or fewer.`);
  }
  return title;
}

function normaliseBody(raw) {
  const body = String(raw == null ? '' : raw).trim();
  if (!body) throw fail(400, 'Write the notice before posting.');
  if (body.length > BODY_MAX) {
    throw fail(400, `Notices must be ${BODY_MAX} characters or fewer.`);
  }
  return body;
}

function normaliseDate(raw, label, { required = false } = {}) {
  if (raw == null || raw === '') {
    if (required) throw fail(400, `${label} is required`);
    return null;
  }
  const text = String(raw).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    throw fail(400, `${label} must be YYYY-MM-DD`);
  }
  const [y, m, d] = text.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (
    dt.getUTCFullYear() !== y ||
    dt.getUTCMonth() !== m - 1 ||
    dt.getUTCDate() !== d
  ) {
    throw fail(400, `${label} is not a valid date`);
  }
  return text;
}

function displayName(row) {
  if (!row) return null;
  const fromParts = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return fromParts || row.name || null;
}

function mapRow(row) {
  if (!row) return null;
  const archived = Boolean(row.archived_at);
  const expiresOn = row.expires_on || null;
  const expired =
    !archived &&
    expiresOn != null &&
    String(expiresOn).slice(0, 10) < new Date().toISOString().slice(0, 10);
  return {
    id: Number(row.id),
    title: row.title,
    body: row.body,
    posted_on: row.posted_on ? String(row.posted_on).slice(0, 10) : null,
    expires_on: expiresOn ? String(expiresOn).slice(0, 10) : null,
    archived_at: row.archived_at || null,
    emailed_at: row.emailed_at || null,
    email_count: Number(row.email_count) || 0,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    created_by: row.created_by != null ? Number(row.created_by) : null,
    author_name: displayName({
      first_name: row.author_first_name,
      last_name: row.author_last_name,
      name: row.author_name,
    }),
    status: archived ? 'archived' : expired ? 'expired' : 'active',
  };
}

const SELECT_SQL = `
  SELECT
    a.id,
    a.title,
    a.body,
    a.posted_on,
    a.expires_on,
    a.archived_at,
    a.emailed_at,
    a.email_count,
    a.created_by,
    a.created_at,
    a.updated_at,
    u.first_name AS author_first_name,
    u.last_name AS author_last_name,
    u.name AS author_name
  FROM shelter_announcements a
  LEFT JOIN users u ON u.user_id = a.created_by
`;

async function getById(id) {
  requireShelterId();
  const announcementId = normaliseId(id, 'announcement');
  const [rows] = await pool.execute(
    `${SELECT_SQL}
      WHERE a.id = ?
      LIMIT 1`,
    [announcementId]
  );
  return mapRow(rows[0] || null);
}

/**
 * List announcements for the current shelter.
 * @param {{ activeOnly?: boolean, includeArchived?: boolean }} opts
 */
async function listAnnouncements({ activeOnly = true, includeArchived = false } = {}) {
  requireShelterId();
  const where = [];
  if (activeOnly) {
    where.push('a.archived_at IS NULL');
    where.push('(a.expires_on IS NULL OR a.expires_on >= CURRENT_DATE)');
  } else if (!includeArchived) {
    where.push('a.archived_at IS NULL');
  }
  const sql = `${SELECT_SQL}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY a.posted_on DESC, a.id DESC`;
  const [rows] = await pool.execute(sql);
  return rows.map(mapRow);
}

async function create({ title, body, postedOn, expiresOn, createdBy } = {}) {
  requireShelterId();
  const cleanTitle = normaliseTitle(title);
  const cleanBody = normaliseBody(body);
  const posted = normaliseDate(postedOn, 'posted_on') || new Date().toISOString().slice(0, 10);
  const expires = normaliseDate(expiresOn, 'expires_on');
  if (expires && expires < posted) {
    throw fail(400, 'Expiry date cannot be before the post date.');
  }
  const authorId =
    createdBy == null || createdBy === ''
      ? null
      : normaliseId(createdBy, 'created_by');

  const [result] = await pool.execute(
    `INSERT INTO shelter_announcements
       (title, body, posted_on, expires_on, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [cleanTitle, cleanBody, posted, expires, authorId]
  );
  return getById(result.insertId);
}

async function update(id, { title, body, postedOn, expiresOn } = {}) {
  requireShelterId();
  const existing = await getById(id);
  if (!existing) throw fail(404, 'Announcement not found');
  if (existing.archived_at) throw fail(400, 'Archived announcements cannot be edited. Post a new one.');

  const cleanTitle = title !== undefined ? normaliseTitle(title) : existing.title;
  const cleanBody = body !== undefined ? normaliseBody(body) : existing.body;
  const posted =
    postedOn !== undefined
      ? normaliseDate(postedOn, 'posted_on', { required: true })
      : existing.posted_on;
  const expires =
    expiresOn !== undefined ? normaliseDate(expiresOn, 'expires_on') : existing.expires_on;
  if (expires && expires < posted) {
    throw fail(400, 'Expiry date cannot be before the post date.');
  }

  await pool.execute(
    `UPDATE shelter_announcements
        SET title = ?,
            body = ?,
            posted_on = ?,
            expires_on = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [cleanTitle, cleanBody, posted, expires, existing.id]
  );
  return getById(existing.id);
}

async function archive(id) {
  requireShelterId();
  const existing = await getById(id);
  if (!existing) throw fail(404, 'Announcement not found');
  if (existing.archived_at) return existing;

  await pool.execute(
    `UPDATE shelter_announcements
        SET archived_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [existing.id]
  );
  return getById(existing.id);
}

/**
 * Active volunteers for email: approved profile, not archived/anonymised, has email.
 */
async function listActiveVolunteerRecipients() {
  requireShelterId();
  const [rows] = await pool.execute(
    `
      SELECT
        u.user_id,
        u.email,
        u.first_name,
        u.last_name,
        u.name
      FROM users u
      INNER JOIN volunteer_profiles vp ON vp.user_id = u.user_id
      WHERE u.role = 'volunteer'
        AND COALESCE(vp.approved, 0) = 1
        AND u.archived_at IS NULL
        AND u.anonymised_at IS NULL
        AND u.email IS NOT NULL
        AND btrim(u.email) <> ''
      ORDER BY u.last_name, u.first_name, u.user_id
    `
  );
  return rows.map((row) => ({
    user_id: Number(row.user_id),
    email: row.email,
    first_name: row.first_name || null,
    last_name: row.last_name || null,
    name: displayName(row),
  }));
}

async function markEmailed(id, recipientCount) {
  requireShelterId();
  const announcementId = normaliseId(id, 'announcement');
  const count = Math.max(0, Number(recipientCount) || 0);
  await pool.execute(
    `UPDATE shelter_announcements
        SET emailed_at = CURRENT_TIMESTAMP,
            email_count = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [count, announcementId]
  );
  return getById(announcementId);
}

module.exports = {
  TITLE_MAX,
  BODY_MAX,
  listAnnouncements,
  getById,
  create,
  update,
  archive,
  listActiveVolunteerRecipients,
  markEmailed,
};
