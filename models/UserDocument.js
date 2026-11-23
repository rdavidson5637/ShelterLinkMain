'use strict';

const path = require('path');
const { pool } = require('../config/database');
const {
  getObjectStorage,
  buildObjectKey,
  isObjectStorageConfigured,
} = require('../utils/objectStorage');

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB

function isAllowedMime(mime) {
  return ALLOWED_MIME_TYPES.has(String(mime || '').toLowerCase());
}

function extensionFor(originalName, mimeType) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  if (['.pdf', '.jpg', '.jpeg', '.png'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  return '';
}

/**
 * Store an uploaded document. When object storage is configured, bytes go to
 * the bucket and the row keeps storage_key only. Otherwise bytes stay in
 * Postgres (`content`) as before — hosts with an ephemeral filesystem still
 * survive redeploys, and `npm run backup` still captures them.
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

  let storageKey = null;
  let dbContent = content;
  const storage = getObjectStorage();

  if (storage.isConfigured()) {
    storageKey = buildObjectKey('documents', userId, extensionFor(originalName, mimeType));
    await storage.put(storageKey, content, mimeType);
    dbContent = null;
  }

  const sql = `
    INSERT INTO user_documents
      (user_id, filename, original_name, mime_type, size, label, expires_at, content, storage_key)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    RETURNING id
  `;
  try {
    const [result] = await pool.execute(sql, [
      userId,
      filename,
      originalName,
      mimeType,
      size,
      label || null,
      expiresAt || null,
      dbContent,
      storageKey,
    ]);
    return findById(result.insertId);
  } catch (error) {
    if (storageKey) {
      try {
        await storage.remove(storageKey);
      } catch (_) {
        /* best-effort cleanup */
      }
    }
    throw error;
  }
}

async function findById(id) {
  // storage_key is internal — never return it on list/detail JSON responses.
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
 * documents never pulls file content into memory. Prefers object storage when
 * storage_key is set; falls back to bytea for older rows.
 */
async function getContent(id) {
  const [rows] = await pool.execute(
    `SELECT content, storage_key, mime_type, original_name, filename
     FROM user_documents WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) return null;

  let buffer = null;
  if (row.storage_key) {
    buffer = await getObjectStorage().get(row.storage_key);
  } else if (row.content) {
    buffer = Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content);
  }
  if (!buffer) return null;

  return {
    buffer,
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
  const [rows] = await pool.execute(
    `SELECT id, user_id, filename, original_name, mime_type, size,
            uploaded_at, expires_at, label, storage_key
     FROM user_documents WHERE id = ? LIMIT 1`,
    [id]
  );
  const doc = rows[0];
  if (!doc) return null;

  if (doc.storage_key) {
    try {
      await getObjectStorage().remove(doc.storage_key);
    } catch (error) {
      console.error('[UserDocument] object storage delete failed:', error.message);
    }
  }

  await pool.execute(`DELETE FROM user_documents WHERE id = ?`, [id]);
  return doc;
}

/**
 * Delete object-storage blobs for a user's documents before the rows are
 * removed (GDPR erase). Safe when object storage is off or keys are null.
 */
async function deleteStoredObjectsForUser(userId) {
  const [rows] = await pool.execute(
    `SELECT storage_key FROM user_documents
     WHERE user_id = ? AND storage_key IS NOT NULL`,
    [userId]
  );
  if (!rows.length) return 0;
  const storage = getObjectStorage();
  let removed = 0;
  for (const row of rows) {
    if (!row.storage_key) continue;
    try {
      await storage.remove(row.storage_key);
      removed += 1;
    } catch (error) {
      console.error('[UserDocument] object storage erase failed:', error.message);
    }
  }
  return removed;
}

module.exports = {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  isAllowedMime,
  isObjectStorageConfigured,
  create,
  findById,
  findByUserId,
  getContent,
  updateMeta,
  remove,
  deleteStoredObjectsForUser,
};
