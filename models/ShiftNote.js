'use strict';

const { pool } = require('../config/database');

const TABLE = 'shift_notes';

function mapNote(row) {
  if (!row) return null;
  return {
    id: row.id,
    opportunity_id: row.opportunity_id,
    author_id: row.author_id,
    body: row.body,
    notify: Number(row.notify) ? 1 : 0,
    created_at: row.created_at,
    author_name:
      row.author_name ||
      [row.author_first_name, row.author_last_name].filter(Boolean).join(' ').trim() ||
      null,
    author_first_name: row.author_first_name || null,
    author_last_name: row.author_last_name || null,
  };
}

async function create({ opportunityId, authorId, body, notify = 0 } = {}) {
  if (!opportunityId) throw new Error('opportunityId is required');
  if (!authorId) throw new Error('authorId is required');
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) throw new Error('body is required');

  const notifyFlag = notify ? 1 : 0;
  const [result] = await pool.execute(
    `
      INSERT INTO ${TABLE} (opportunity_id, author_id, body, notify)
      VALUES (?, ?, ?, ?)
    `,
    [Number(opportunityId), Number(authorId), text, notifyFlag]
  );

  return findById(result.insertId);
}

async function findById(noteId) {
  if (!noteId) return null;
  const [rows] = await pool.execute(
    `
      SELECT
        sn.id,
        sn.opportunity_id,
        sn.author_id,
        sn.body,
        sn.notify,
        sn.created_at,
        u.first_name AS author_first_name,
        u.last_name AS author_last_name,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS author_name
      FROM ${TABLE} sn
      LEFT JOIN users u ON u.user_id = sn.author_id
      WHERE sn.id = ?
      LIMIT 1
    `,
    [Number(noteId)]
  );
  return mapNote(rows[0] || null);
}

async function findByOpportunityId(opportunityId) {
  if (!opportunityId) return [];
  const [rows] = await pool.execute(
    `
      SELECT
        sn.id,
        sn.opportunity_id,
        sn.author_id,
        sn.body,
        sn.notify,
        sn.created_at,
        u.first_name AS author_first_name,
        u.last_name AS author_last_name,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS author_name
      FROM ${TABLE} sn
      LEFT JOIN users u ON u.user_id = sn.author_id
      WHERE sn.opportunity_id = ?
      ORDER BY sn.created_at DESC, sn.id DESC
    `,
    [Number(opportunityId)]
  );
  return rows.map(mapNote);
}

/**
 * Batch-load notes for many opportunities. Returns Map<opportunityId, notes[]>.
 */
async function findByOpportunityIds(opportunityIds = []) {
  const ids = [...new Set(opportunityIds.map(Number).filter((id) => Number.isFinite(id) && id > 0))];
  const byOpp = new Map();
  for (const id of ids) byOpp.set(id, []);
  if (!ids.length) return byOpp;

  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `
      SELECT
        sn.id,
        sn.opportunity_id,
        sn.author_id,
        sn.body,
        sn.notify,
        sn.created_at,
        u.first_name AS author_first_name,
        u.last_name AS author_last_name,
        TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS author_name
      FROM ${TABLE} sn
      LEFT JOIN users u ON u.user_id = sn.author_id
      WHERE sn.opportunity_id IN (${placeholders})
      ORDER BY sn.created_at DESC, sn.id DESC
    `,
    ids
  );

  for (const row of rows) {
    const list = byOpp.get(Number(row.opportunity_id)) || [];
    list.push(mapNote(row));
    byOpp.set(Number(row.opportunity_id), list);
  }
  return byOpp;
}

async function remove(noteId) {
  if (!noteId) return false;
  const [result] = await pool.execute(`DELETE FROM ${TABLE} WHERE id = ?`, [Number(noteId)]);
  return Number(result.affectedRows) > 0;
}

module.exports = {
  create,
  findById,
  findByOpportunityId,
  findByOpportunityIds,
  remove,
};
