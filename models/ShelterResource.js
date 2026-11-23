'use strict';

/**
 * Per-shelter resource library (SL-DAY-04).
 * Named links or uploaded handbook/policy files for volunteers.
 * Reuses object storage when configured; otherwise Postgres bytea.
 */

const path = require('path');
const crypto = require('crypto');
const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');
const {
  getObjectStorage,
  buildObjectKey,
} = require('../utils/objectStorage');
const { sniffDocument, canonicalMime } = require('../utils/fileSignature');

const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
]);

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5MB
const MAX_TITLE = 200;
const MAX_URL = 2000;
const MAX_RESOURCES = 100;

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

function isAllowedMime(mime) {
  return ALLOWED_MIME_TYPES.has(String(mime || '').toLowerCase());
}

function normaliseTitle(raw) {
  if (raw == null) throw fail(400, 'Enter a resource title.');
  const title = String(raw).trim().replace(/\s+/g, ' ');
  if (!title) throw fail(400, 'Enter a resource title.');
  if (title.length > MAX_TITLE) {
    throw fail(400, `Title must be ${MAX_TITLE} characters or fewer.`);
  }
  return title;
}

function normaliseUrl(raw) {
  if (raw == null) throw fail(400, 'Enter a link URL.');
  const url = String(raw).trim();
  if (!url) throw fail(400, 'Enter a link URL.');
  if (url.length > MAX_URL) {
    throw fail(400, `URL must be ${MAX_URL} characters or fewer.`);
  }
  let parsed;
  try {
    parsed = new URL(url);
  } catch (_) {
    throw fail(400, 'Enter a valid http or https link.');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw fail(400, 'Links must use http or https.');
  }
  return parsed.toString();
}

function extensionFor(originalName, mimeType) {
  const ext = path.extname(String(originalName || '')).toLowerCase();
  if (['.pdf', '.jpg', '.jpeg', '.png'].includes(ext)) return ext === '.jpeg' ? '.jpg' : ext;
  if (mimeType === 'application/pdf') return '.pdf';
  if (mimeType === 'image/png') return '.png';
  if (mimeType === 'image/jpeg') return '.jpg';
  return '';
}

function safeDownloadName(name) {
  const base = path.basename(String(name || 'document')).replace(/["\r\n\\]/g, '');
  const cleaned = base.replace(/[^\w.\- ()]+/g, '_').replace(/^\.+/, '').slice(0, 120);
  return cleaned || 'document';
}

function mapResource(row) {
  if (!row) return null;
  const kind = row.kind === 'file' ? 'file' : 'link';
  return {
    id: Number(row.id),
    title: row.title,
    kind,
    url: kind === 'link' ? row.url || null : null,
    original_name: kind === 'file' ? row.original_name || null : null,
    mime_type: kind === 'file' ? row.mime_type || null : null,
    size: kind === 'file' && row.size != null ? Number(row.size) : null,
    sort_order: Number(row.sort_order) || 0,
    active: Boolean(Number(row.active)),
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}

async function nextSortOrder() {
  const [rows] = await pool.execute(
    `SELECT COALESCE(MAX(sort_order), -1)::int AS max_order
       FROM shelter_resources`
  );
  return Number(rows[0]?.max_order || -1) + 1;
}

async function countResources() {
  const [rows] = await pool.execute(
    `SELECT COUNT(*)::int AS count FROM shelter_resources`
  );
  return Number(rows[0]?.count || 0);
}

async function findById(id) {
  requireShelterId();
  const [rows] = await pool.execute(
    `SELECT id, title, kind, url, filename, original_name, mime_type, size,
            sort_order, active, created_at, updated_at
       FROM shelter_resources
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  return mapResource(rows[0] || null);
}

async function listResources({ activeOnly = false } = {}) {
  requireShelterId();
  const sql = `
    SELECT id, title, kind, url, filename, original_name, mime_type, size,
           sort_order, active, created_at, updated_at
      FROM shelter_resources
     ${activeOnly ? 'WHERE active = 1' : ''}
     ORDER BY sort_order ASC, id ASC
  `;
  const [rows] = await pool.execute(sql);
  return rows.map(mapResource);
}

async function createLink({ title, url, sort_order = null, createdBy = null } = {}) {
  requireShelterId();
  const normalisedTitle = normaliseTitle(title);
  const normalisedUrl = normaliseUrl(url);
  if ((await countResources()) >= MAX_RESOURCES) {
    throw fail(400, `Keep the resource library to ${MAX_RESOURCES} items or fewer.`);
  }

  let order = Number(sort_order);
  if (!Number.isFinite(order)) order = await nextSortOrder();

  const [result] = await pool.execute(
    `INSERT INTO shelter_resources
       (title, kind, url, sort_order, active, created_by)
     VALUES (?, 'link', ?, ?, 1, ?)
     RETURNING id`,
    [normalisedTitle, normalisedUrl, order, createdBy || null]
  );
  return findById(result.insertId);
}

async function createFile({
  title,
  content,
  originalName,
  mimeType,
  size,
  sort_order = null,
  createdBy = null,
} = {}) {
  requireShelterId();
  const shelterId = requireShelterId();
  const normalisedTitle = normaliseTitle(title);

  if (!Buffer.isBuffer(content) || content.length === 0) {
    throw fail(400, 'File is required');
  }
  if (content.length > MAX_FILE_SIZE) {
    throw fail(400, 'File too large. Maximum size is 5MB.');
  }
  if (!isAllowedMime(mimeType)) {
    throw fail(400, 'Only PDF, JPG, and PNG files are allowed');
  }
  const detected = sniffDocument(content);
  if (!detected || detected !== canonicalMime(mimeType)) {
    throw fail(400, 'File contents do not match the declared type');
  }
  if ((await countResources()) >= MAX_RESOURCES) {
    throw fail(400, `Keep the resource library to ${MAX_RESOURCES} items or fewer.`);
  }

  let order = Number(sort_order);
  if (!Number.isFinite(order)) order = await nextSortOrder();

  const safeName = safeDownloadName(originalName || 'document');
  const ext = extensionFor(safeName, detected);
  const filename = `${crypto.randomBytes(16).toString('hex')}${ext}`;

  let storageKey = null;
  let dbContent = content;
  const storage = getObjectStorage();
  if (storage.isConfigured()) {
    storageKey = buildObjectKey('shelter-resources', shelterId, ext);
    await storage.put(storageKey, content, detected);
    dbContent = null;
  }

  try {
    const [result] = await pool.execute(
      `INSERT INTO shelter_resources
         (title, kind, filename, original_name, mime_type, size, content, storage_key,
          sort_order, active, created_by)
       VALUES (?, 'file', ?, ?, ?, ?, ?, ?, ?, 1, ?)
       RETURNING id`,
      [
        normalisedTitle,
        filename,
        safeName,
        detected,
        size || content.length,
        dbContent,
        storageKey,
        order,
        createdBy || null,
      ]
    );
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

async function updateResource(id, { title, url, sort_order, active } = {}) {
  requireShelterId();
  const existing = await findById(id);
  if (!existing) throw fail(404, 'Resource not found');

  const fields = [];
  const params = [];

  if (typeof title !== 'undefined') {
    fields.push('title = ?');
    params.push(normaliseTitle(title));
  }
  if (typeof url !== 'undefined') {
    if (existing.kind !== 'link') {
      throw fail(400, 'Only link resources have a URL.');
    }
    fields.push('url = ?');
    params.push(normaliseUrl(url));
  }
  if (typeof sort_order !== 'undefined' && sort_order !== null && sort_order !== '') {
    const order = Number(sort_order);
    if (!Number.isFinite(order) || !Number.isInteger(order)) {
      throw fail(400, 'Order must be a whole number.');
    }
    fields.push('sort_order = ?');
    params.push(order);
  }
  if (typeof active !== 'undefined' && active !== null && active !== '') {
    const flag = active === true || active === 1 || active === '1' || active === 'true';
    fields.push('active = ?');
    params.push(flag ? 1 : 0);
  }

  if (!fields.length) throw fail(400, 'No fields provided for update');

  fields.push('updated_at = CURRENT_TIMESTAMP');
  params.push(id);
  const [result] = await pool.execute(
    `UPDATE shelter_resources SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
  if (!result.affectedRows) throw fail(404, 'Resource not found');
  return findById(id);
}

async function getContent(id) {
  requireShelterId();
  const [rows] = await pool.execute(
    `SELECT kind, content, storage_key, mime_type, original_name, filename, active
       FROM shelter_resources
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row || row.kind !== 'file') return null;

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
    originalName: row.original_name || row.filename || 'document',
    active: Boolean(Number(row.active)),
  };
}

async function remove(id) {
  requireShelterId();
  const [rows] = await pool.execute(
    `SELECT id, kind, storage_key FROM shelter_resources WHERE id = ? LIMIT 1`,
    [id]
  );
  const row = rows[0];
  if (!row) throw fail(404, 'Resource not found');

  if (row.storage_key) {
    try {
      await getObjectStorage().remove(row.storage_key);
    } catch (error) {
      console.error('[ShelterResource] object storage delete failed:', error.message);
    }
  }

  await pool.execute(`DELETE FROM shelter_resources WHERE id = ?`, [id]);
  return { id: Number(row.id) };
}

module.exports = {
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
  MAX_TITLE,
  MAX_URL,
  MAX_RESOURCES,
  isAllowedMime,
  normaliseTitle,
  normaliseUrl,
  safeDownloadName,
  listResources,
  findById,
  createLink,
  createFile,
  updateResource,
  getContent,
  remove,
};
