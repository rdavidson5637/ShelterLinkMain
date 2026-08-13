'use strict';

const path = require('path');
const fs = require('fs');
const { pool } = require('../config/database');

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function getUploadDir() {
  const dir =
    process.env.UPLOAD_DIR ||
    path.join(__dirname, '..', 'storage', 'uploads');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function isAllowedMime(mime) {
  return ALLOWED_MIME_TYPES.has(String(mime || '').toLowerCase());
}

async function create({
  userId,
  filename,
  originalName,
  mimeType,
  size,
  label = null,
  expiresAt = null,
}) {
  const sql = `
    INSERT INTO user_documents
      (user_id, filename, original_name, mime_type, size, label, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `;
  const [result] = await pool.execute(sql, [
    userId,
    filename,
    originalName,
    mimeType,
    size,
    label || null,
    expiresAt || null,
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

  const filePath = path.join(getUploadDir(), doc.filename);
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (_) {
    // continue deleting DB row even if file is missing
  }

  await pool.execute(`DELETE FROM user_documents WHERE id = ?`, [id]);
  return doc;
}

function absolutePathFor(doc) {
  if (!doc || !doc.filename) return null;
  return path.join(getUploadDir(), doc.filename);
}

module.exports = {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  getUploadDir,
  isAllowedMime,
  create,
  findById,
  findByUserId,
  updateMeta,
  remove,
  absolutePathFor,
};
