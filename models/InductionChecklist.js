'use strict';

/**
 * New-volunteer induction checklist (SL-DAY-02).
 * Per-shelter item template + per-volunteer progress ticks.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');

const MAX_ITEMS = 20;
const MAX_TITLE = 200;

const STARTER_TITLES = [
  'Welcome email seen',
  'Site tour',
  'Shadow shift',
  'Policies acknowledged',
];

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

function normaliseTitle(raw) {
  if (raw == null) throw fail(400, 'Enter a checklist item title.');
  const title = String(raw).trim().replace(/\s+/g, ' ');
  if (!title) throw fail(400, 'Enter a checklist item title.');
  if (title.length > MAX_TITLE) {
    throw fail(400, `Title must be ${MAX_TITLE} characters or fewer.`);
  }
  return title;
}

function mapItem(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    title: row.title,
    sort_order: Number(row.sort_order) || 0,
    active: Boolean(Number(row.active)),
    created_at: row.created_at,
  };
}

async function countActiveItems() {
  const [rows] = await pool.execute(
    `SELECT COUNT(*)::int AS count
       FROM induction_checklist_items
      WHERE active = 1`
  );
  return Number(rows[0]?.count || 0);
}

async function findItemById(id) {
  const [rows] = await pool.execute(
    `SELECT id, title, sort_order, active, created_at
       FROM induction_checklist_items
      WHERE id = ?
      LIMIT 1`,
    [id]
  );
  return mapItem(rows[0] || null);
}

async function listItems({ activeOnly = false } = {}) {
  requireShelterId();
  const sql = `
    SELECT id, title, sort_order, active, created_at
      FROM induction_checklist_items
     ${activeOnly ? 'WHERE active = 1' : ''}
     ORDER BY sort_order ASC, id ASC
  `;
  const [rows] = await pool.execute(sql);
  return rows.map(mapItem);
}

async function createItem({ title, sort_order = null } = {}) {
  requireShelterId();
  const normalised = normaliseTitle(title);
  const activeCount = await countActiveItems();
  if (activeCount >= MAX_ITEMS) {
    throw fail(400, `Keep the induction checklist to ${MAX_ITEMS} items or fewer.`);
  }

  let order = Number(sort_order);
  if (!Number.isFinite(order)) {
    const [rows] = await pool.execute(
      `SELECT COALESCE(MAX(sort_order), -1)::int AS max_order
         FROM induction_checklist_items`
    );
    order = Number(rows[0]?.max_order || -1) + 1;
  }

  const [result] = await pool.execute(
    `INSERT INTO induction_checklist_items (title, sort_order, active)
     VALUES (?, ?, 1)`,
    [normalised, order]
  );
  return findItemById(result.insertId);
}

async function updateItem(id, data = {}) {
  requireShelterId();
  const existing = await findItemById(id);
  if (!existing) throw fail(404, 'Checklist item not found');

  const fields = [];
  const params = [];

  if (typeof data.title !== 'undefined') {
    fields.push('title = ?');
    params.push(normaliseTitle(data.title));
  }
  if (typeof data.sort_order !== 'undefined' && data.sort_order !== null && data.sort_order !== '') {
    const order = Number(data.sort_order);
    if (!Number.isFinite(order)) throw fail(400, 'sort_order must be a number');
    fields.push('sort_order = ?');
    params.push(order);
  }
  if (typeof data.active !== 'undefined' && data.active !== null && data.active !== '') {
    const on =
      data.active === true ||
      data.active === 1 ||
      data.active === '1' ||
      String(data.active).toLowerCase() === 'true';
    if (on && !existing.active) {
      const activeCount = await countActiveItems();
      if (activeCount >= MAX_ITEMS) {
        throw fail(400, `Keep the induction checklist to ${MAX_ITEMS} items or fewer.`);
      }
    }
    fields.push('active = ?');
    params.push(on ? 1 : 0);
  }

  if (!fields.length) return existing;

  params.push(id);
  await pool.execute(
    `UPDATE induction_checklist_items SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
  return findItemById(id);
}

async function deleteItem(id) {
  requireShelterId();
  const existing = await findItemById(id);
  if (!existing) throw fail(404, 'Checklist item not found');
  await pool.execute(`DELETE FROM induction_checklist_items WHERE id = ?`, [id]);
  return { deleted: true, id: Number(id) };
}

async function seedStarterItems() {
  requireShelterId();
  const existing = await listItems({ activeOnly: false });
  if (existing.length) {
    throw fail(400, 'This shelter already has induction checklist items.');
  }
  const created = [];
  for (let i = 0; i < STARTER_TITLES.length; i += 1) {
    created.push(await createItem({ title: STARTER_TITLES[i], sort_order: i }));
  }
  return created;
}

async function getVolunteerProgress(userId) {
  requireShelterId();
  const uid = Number(userId);
  if (!Number.isInteger(uid) || uid <= 0) throw fail(400, 'Invalid volunteer');

  const [userRows] = await pool.execute(
    `SELECT user_id FROM users WHERE user_id = ? AND role = 'volunteer' LIMIT 1`,
    [uid]
  );
  if (!userRows.length) throw fail(404, 'Volunteer not found');

  const [rows] = await pool.execute(
    `SELECT i.id, i.title, i.sort_order, i.active,
            p.completed_at, p.completed_by
       FROM induction_checklist_items i
       LEFT JOIN induction_checklist_progress p
         ON p.item_id = i.id AND p.user_id = ?
      WHERE i.active = 1
      ORDER BY i.sort_order ASC, i.id ASC`,
    [uid]
  );

  const items = rows.map((row) => ({
    id: Number(row.id),
    title: row.title,
    sort_order: Number(row.sort_order) || 0,
    done: Boolean(row.completed_at),
    completed_at: row.completed_at || null,
    completed_by: row.completed_by != null ? Number(row.completed_by) : null,
  }));

  const doneCount = items.filter((item) => item.done).length;
  return {
    user_id: uid,
    items,
    doneCount,
    total: items.length,
    complete: items.length > 0 && doneCount === items.length,
  };
}

async function setItemDone(userId, itemId, { done, completedBy } = {}) {
  requireShelterId();
  const uid = Number(userId);
  const iid = Number(itemId);
  if (!Number.isInteger(uid) || uid <= 0) throw fail(400, 'Invalid volunteer');
  if (!Number.isInteger(iid) || iid <= 0) throw fail(400, 'Invalid checklist item');

  const item = await findItemById(iid);
  if (!item || !item.active) throw fail(404, 'Checklist item not found');

  const [userRows] = await pool.execute(
    `SELECT user_id FROM users WHERE user_id = ? AND role = 'volunteer' LIMIT 1`,
    [uid]
  );
  if (!userRows.length) throw fail(404, 'Volunteer not found');

  const markDone =
    done === true ||
    done === 1 ||
    done === '1' ||
    String(done).toLowerCase() === 'true';

  if (markDone) {
    const by =
      completedBy != null && Number.isInteger(Number(completedBy)) && Number(completedBy) > 0
        ? Number(completedBy)
        : null;
    await pool.execute(
      `INSERT INTO induction_checklist_progress (user_id, item_id, completed_by)
       VALUES (?, ?, ?)
       ON CONFLICT (user_id, item_id) DO UPDATE
         SET completed_at = CURRENT_TIMESTAMP,
             completed_by = EXCLUDED.completed_by`,
      [uid, iid, by]
    );
  } else {
    await pool.execute(
      `DELETE FROM induction_checklist_progress
        WHERE user_id = ? AND item_id = ?`,
      [uid, iid]
    );
  }

  return getVolunteerProgress(uid);
}

module.exports = {
  MAX_ITEMS,
  STARTER_TITLES,
  listItems,
  findItemById,
  createItem,
  updateItem,
  deleteItem,
  seedStarterItems,
  getVolunteerProgress,
  setItemDone,
  normaliseTitle,
};
