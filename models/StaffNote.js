'use strict';

/**
 * Private staff notes on a volunteer profile (SL-DAY-15).
 * Staff-only. Never returned to the volunteer or included in GDPR export.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');

const BODY_MAX = 4000;

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

function normaliseUserId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw fail(400, `Invalid ${label}`);
  }
  return id;
}

function normaliseBody(raw) {
  const body = String(raw == null ? '' : raw).trim();
  if (!body) throw fail(400, 'Write a note before saving.');
  if (body.length > BODY_MAX) {
    throw fail(400, `Notes must be ${BODY_MAX} characters or fewer.`);
  }
  return body;
}

function displayName(row) {
  if (!row) return null;
  const fromParts = [row.first_name, row.last_name].filter(Boolean).join(' ').trim();
  return fromParts || row.name || null;
}

function mapNote(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    volunteer_user_id: Number(row.volunteer_user_id),
    body: row.body,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    author: {
      user_id: Number(row.author_user_id),
      name: displayName({
        first_name: row.author_first_name,
        last_name: row.author_last_name,
        name: row.author_name,
      }),
    },
    updated_by:
      row.updated_by != null
        ? {
            user_id: Number(row.updated_by),
            name: displayName({
              first_name: row.editor_first_name,
              last_name: row.editor_last_name,
              name: row.editor_name,
            }),
          }
        : null,
    edited:
      row.updated_at &&
      row.created_at &&
      String(row.updated_at) !== String(row.created_at),
  };
}

const NOTE_SELECT = `
  SELECT
    n.id,
    n.volunteer_user_id,
    n.author_user_id,
    n.body,
    n.created_at,
    n.updated_at,
    n.updated_by,
    a.first_name AS author_first_name,
    a.last_name AS author_last_name,
    a.name AS author_name,
    e.first_name AS editor_first_name,
    e.last_name AS editor_last_name,
    e.name AS editor_name
  FROM volunteer_staff_notes n
  JOIN users a ON a.user_id = n.author_user_id
  LEFT JOIN users e ON e.user_id = n.updated_by
`;

async function findActiveVolunteer(userId) {
  const [rows] = await pool.execute(
    `SELECT user_id, first_name, last_name, name, email, role, archived_at, anonymised_at
       FROM users
      WHERE user_id = ?
        AND role = 'volunteer'
      LIMIT 1`,
    [userId]
  );
  const row = rows[0];
  if (!row) return null;
  if (row.archived_at || row.anonymised_at) return null;
  return row;
}

async function listForVolunteer(volunteerUserId) {
  requireShelterId();
  const id = normaliseUserId(volunteerUserId, 'volunteer');
  const volunteer = await findActiveVolunteer(id);
  if (!volunteer) throw fail(404, 'Volunteer not found');

  const [rows] = await pool.execute(
    `${NOTE_SELECT}
      WHERE n.volunteer_user_id = ?
      ORDER BY n.created_at DESC, n.id DESC`,
    [id]
  );

  return {
    volunteer: {
      user_id: Number(volunteer.user_id),
      name: displayName(volunteer),
    },
    notes: rows.map(mapNote),
  };
}

async function getById(noteId, volunteerUserId) {
  requireShelterId();
  const nid = normaliseUserId(noteId, 'note');
  const vid = normaliseUserId(volunteerUserId, 'volunteer');
  const [rows] = await pool.execute(
    `${NOTE_SELECT}
      WHERE n.id = ?
        AND n.volunteer_user_id = ?
      LIMIT 1`,
    [nid, vid]
  );
  return mapNote(rows[0] || null);
}

async function create({ volunteerUserId, authorUserId, body } = {}) {
  requireShelterId();
  const volunteerId = normaliseUserId(volunteerUserId, 'volunteer');
  const authorId = normaliseUserId(authorUserId, 'author');
  const text = normaliseBody(body);

  const volunteer = await findActiveVolunteer(volunteerId);
  if (!volunteer) throw fail(404, 'Volunteer not found');

  const [result] = await pool.execute(
    `INSERT INTO volunteer_staff_notes (volunteer_user_id, author_user_id, body)
     VALUES (?, ?, ?)`,
    [volunteerId, authorId, text]
  );
  const noteId = Number(result.insertId);
  const note = await getById(noteId, volunteerId);
  return { note, created: true };
}

async function update({ noteId, volunteerUserId, editorUserId, body } = {}) {
  requireShelterId();
  const nid = normaliseUserId(noteId, 'note');
  const volunteerId = normaliseUserId(volunteerUserId, 'volunteer');
  const editorId = normaliseUserId(editorUserId, 'editor');
  const text = normaliseBody(body);

  const existing = await getById(nid, volunteerId);
  if (!existing) throw fail(404, 'Note not found');

  if (existing.body === text) {
    return { note: existing, changed: false, previous_body: existing.body };
  }

  const [result] = await pool.execute(
    `UPDATE volunteer_staff_notes
        SET body = ?,
            updated_at = CURRENT_TIMESTAMP,
            updated_by = ?
      WHERE id = ?
        AND volunteer_user_id = ?`,
    [text, editorId, nid, volunteerId]
  );
  if (!result.affectedRows) throw fail(404, 'Note not found');

  const note = await getById(nid, volunteerId);
  return { note, changed: true, previous_body: existing.body };
}

async function remove({ noteId, volunteerUserId } = {}) {
  requireShelterId();
  const nid = normaliseUserId(noteId, 'note');
  const volunteerId = normaliseUserId(volunteerUserId, 'volunteer');

  const existing = await getById(nid, volunteerId);
  if (!existing) throw fail(404, 'Note not found');

  await pool.execute(
    `DELETE FROM volunteer_staff_notes
      WHERE id = ?
        AND volunteer_user_id = ?`,
    [nid, volunteerId]
  );
  return { deleted: true, note: existing };
}

module.exports = {
  BODY_MAX,
  listForVolunteer,
  getById,
  create,
  update,
  remove,
  findActiveVolunteer,
};
