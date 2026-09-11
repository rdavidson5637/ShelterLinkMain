'use strict';

const { pool } = require('../config/database');

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function isAllowedMime(mime) {
  return ALLOWED_MIME_TYPES.has(String(mime || '').toLowerCase());
}

/**
 * Store an uploaded document. `content` is the file bytes (Buffer) — files live
 * in Postgres, not on disk, so they survive redeploys on ephemeral hosts and
 * are captured by `npm run backup`. `filename` stays as an opaque id purely for
 * backwards compatibility with existing rows and the NOT NULL column.
 */
async function create({
  userId,
  content,
  filename,
  originalName,
  mimeType,
  size,
  label = null,
  expiresAt = null,
}) {
  if (!Buffer.isBuffer(content) || content.length === 0) {
    throw new Error('Document content is required');
  }
  const sql = `
    INSERT INTO user_documents
      (user_id, filename, original_name, mime_type, size, label, expires_at, content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `;
  const [result] = await pool.execute(sql, [
    userId,
    filename,
    originalName,
    mimeType,
    size,
    label || null,
    expiresAt || null,
    content,
  ]);
  return findById(result.insertId);
}

async function findById(id) {
  const [rows] = await pool.execute(
    `SELECT id, user_id, filename, original_name, mime_type, size,
            uploaded_at, expires_at, label
     FROM user_documents WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function findByUserId(userId) {
  const [rows] = await pool.execute(
    `SELECT id, user_id, filename, original_name, mime_type, size,
            uploaded_at, expires_at, label
     FROM user_documents
     WHERE user_id = ?
     ORDER BY uploaded_at DESC`,
    [userId]
  );
  return rows;
}

/**
 * Fetch the raw bytes for download. Kept separate from findById so listing
 * documents never pulls file content into memory.
 */
async function getContent(id) {
  const [rows] = await pool.execute(
    `SELECT content, mime_type, original_name, filename
     FROM user_documents WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row || !row.content) return null;
  return {
    buffer: Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content),
    mimeType: row.mime_type,
    originalName: row.original_name || row.filename,
  };
}

async function updateMeta(id, { label, expires_at } = {}) {
  const fields = [];
  const params = [];

  if (typeof label !== 'undefined') {
    fields.push('label = ?');
    params.push(label === '' || label == null ? null : String(label));
  }
  if (typeof expires_at !== 'undefined') {
    fields.push('expires_at = ?');
    params.push(expires_at === '' || expires_at == null ? null : String(expires_at).slice(0, 10));
  }

  if (!fields.length) {
    return findById(id);
  }

  params.push(id);
  const [result] = await pool.execute(
    `UPDATE user_documents SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
  if (!result.affectedRows) return null;
  return findById(id);
}

async function remove(id) {
  const doc = await findById(id);
  if (!doc) return null;
  await pool.execute(`DELETE FROM user_documents WHERE id = ?`, [id]);
  return doc;
}

module.exports = {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  isAllowedMime,
  create,
  findById,
  findByUserId,
  getContent,
  updateMeta,
  remove,
};
