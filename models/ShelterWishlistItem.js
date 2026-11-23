'use strict';

/**
 * Public supplies wishlist items (SL-DAY-18).
 * Staff manage name, quantity, priority, and optional note per shelter.
 * Public page shows active items and a list-level updated_on date.
 * No payments or donation processing.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');

const NAME_MAX = 160;
const NOTE_MAX = 500;
const QUANTITY_MAX = 9999;
const PRIORITIES = new Set(['high', 'medium', 'low']);
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };

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

function normaliseName(raw) {
  const name = String(raw == null ? '' : raw).trim();
  if (!name) throw fail(400, 'Add an item name.');
  if (name.length > NAME_MAX) {
    throw fail(400, `Item name must be ${NAME_MAX} characters or fewer.`);
  }
  return name;
}

function normaliseQuantity(raw) {
  if (raw == null || raw === '') throw fail(400, 'Add a quantity.');
  const quantity = Number(raw);
  if (!Number.isInteger(quantity) || quantity < 1 || quantity > QUANTITY_MAX) {
    throw fail(400, `Quantity must be a whole number from 1 to ${QUANTITY_MAX}.`);
  }
  return quantity;
}

function normalisePriority(raw) {
  const priority = String(raw == null || raw === '' ? 'medium' : raw)
    .trim()
    .toLowerCase();
  if (!PRIORITIES.has(priority)) {
    throw fail(400, 'Priority must be high, medium, or low.');
  }
  return priority;
}

function normaliseNote(raw) {
  if (raw == null || raw === '') return null;
  const note = String(raw).trim();
  if (!note) return null;
  if (note.length > NOTE_MAX) {
    throw fail(400, `Note must be ${NOTE_MAX} characters or fewer.`);
  }
  return note;
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    quantity: Number(row.quantity),
    priority: row.priority,
    note: row.note || null,
    archived_at: row.archived_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    created_by: row.created_by != null ? Number(row.created_by) : null,
  };
}

function publicItem(row) {
  return {
    id: row.id,
    name: row.name,
    quantity: row.quantity,
    priority: row.priority,
    note: row.note,
  };
}

function sortItems(items) {
  return items.slice().sort((a, b) => {
    const rankA = PRIORITY_RANK[a.priority] ?? 9;
    const rankB = PRIORITY_RANK[b.priority] ?? 9;
    if (rankA !== rankB) return rankA - rankB;
    return a.id - b.id;
  });
}

function updatedOnFrom(items) {
  let latest = null;
  for (const item of items) {
    const stamp = item.updated_at || item.created_at;
    if (!stamp) continue;
    const iso = new Date(stamp).toISOString();
    if (!latest || iso > latest) latest = iso;
  }
  return latest ? latest.slice(0, 10) : null;
}

const SELECT_SQL = `
  SELECT
    id,
    name,
    quantity,
    priority,
    note,
    archived_at,
    created_by,
    created_at,
    updated_at
  FROM shelter_wishlist_items
`;

async function getById(id) {
  requireShelterId();
  const itemId = normaliseId(id, 'wishlist item');
  const [rows] = await pool.execute(
    `${SELECT_SQL}
      WHERE id = ?
      LIMIT 1`,
    [itemId]
  );
  return mapRow(rows[0] || null);
}

/**
 * @param {{ activeOnly?: boolean, includeArchived?: boolean }} opts
 */
async function listItems({ activeOnly = true, includeArchived = false } = {}) {
  requireShelterId();
  const where = [];
  if (activeOnly) {
    where.push('archived_at IS NULL');
  } else if (!includeArchived) {
    where.push('archived_at IS NULL');
  }
  const sql = `${SELECT_SQL}
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY
      CASE priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
      id ASC`;
  const [rows] = await pool.execute(sql);
  return rows.map(mapRow);
}

async function listPublic() {
  const items = await listItems({ activeOnly: true });
  return {
    items: sortItems(items).map(publicItem),
    updated_on: updatedOnFrom(items),
    total: items.length,
  };
}

async function create({ name, quantity, priority, note, createdBy } = {}) {
  requireShelterId();
  const cleanName = normaliseName(name);
  const cleanQuantity = normaliseQuantity(quantity);
  const cleanPriority = normalisePriority(priority);
  const cleanNote = normaliseNote(note);
  const authorId =
    createdBy == null || createdBy === ''
      ? null
      : normaliseId(createdBy, 'created_by');

  const [result] = await pool.execute(
    `INSERT INTO shelter_wishlist_items
       (name, quantity, priority, note, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [cleanName, cleanQuantity, cleanPriority, cleanNote, authorId]
  );
  return getById(result.insertId);
}

async function update(id, { name, quantity, priority, note } = {}) {
  requireShelterId();
  const existing = await getById(id);
  if (!existing) throw fail(404, 'Wishlist item not found');
  if (existing.archived_at) {
    throw fail(400, 'Archived items cannot be edited. Add a new one.');
  }

  const cleanName = name !== undefined ? normaliseName(name) : existing.name;
  const cleanQuantity =
    quantity !== undefined ? normaliseQuantity(quantity) : existing.quantity;
  const cleanPriority =
    priority !== undefined ? normalisePriority(priority) : existing.priority;
  const cleanNote = note !== undefined ? normaliseNote(note) : existing.note;

  await pool.execute(
    `UPDATE shelter_wishlist_items
        SET name = ?,
            quantity = ?,
            priority = ?,
            note = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [cleanName, cleanQuantity, cleanPriority, cleanNote, existing.id]
  );
  return getById(existing.id);
}

async function archive(id) {
  requireShelterId();
  const existing = await getById(id);
  if (!existing) throw fail(404, 'Wishlist item not found');
  if (existing.archived_at) return existing;

  await pool.execute(
    `UPDATE shelter_wishlist_items
        SET archived_at = CURRENT_TIMESTAMP,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`,
    [existing.id]
  );
  return getById(existing.id);
}

module.exports = {
  NAME_MAX,
  NOTE_MAX,
  QUANTITY_MAX,
  PRIORITIES,
  listItems,
  listPublic,
  getById,
  create,
  update,
  archive,
  publicItem,
  updatedOnFrom,
};
