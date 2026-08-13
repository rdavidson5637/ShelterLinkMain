'use strict';

const { pool } = require('../config/database');

async function create({ userId = null, action, entityType = null, entityId = null, detail = null }) {
  if (!action) throw new Error('action is required');

  let detailJson = null;
  if (detail != null) {
    detailJson = typeof detail === 'string' ? detail : JSON.stringify(detail);
  }

  const entityIdStr = entityId == null ? null : String(entityId);

  const [result] = await pool.execute(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, detail_json, created_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [userId, action, entityType, entityIdStr, detailJson]
  );
  return result.insertId;
}

/**
 * List audit rows with optional filters.
 * @param {{ action?: string, entityType?: string, userId?: number, from?: string, to?: string, limit?: number, offset?: number }} filters
 */
async function findAll(filters = {}) {
  const where = [];
  const params = [];

  if (filters.action) {
    where.push('a.action = ?');
    params.push(filters.action);
  }
  if (filters.entityType) {
    where.push('a.entity_type = ?');
    params.push(filters.entityType);
  }
  if (filters.userId) {
    where.push('a.user_id = ?');
    params.push(Number(filters.userId));
  }
  if (filters.from) {
    where.push('a.created_at >= ?');
    params.push(filters.from);
  }
  if (filters.to) {
    where.push('a.created_at <= ?');
    params.push(filters.to);
  }

  const limit = Math.min(Math.max(Number(filters.limit) || 100, 1), 500);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const [rows] = await pool.execute(
    `SELECT
       a.id,
       a.user_id,
       a.action,
       a.entity_type,
       a.entity_id,
       a.detail_json,
       a.created_at,
       u.email AS actor_email,
       u.first_name AS actor_first_name,
       u.last_name AS actor_last_name,
       u.role AS actor_role
     FROM audit_log a
     LEFT JOIN users u ON u.user_id = a.user_id
     ${whereSql}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ${limit} OFFSET ${offset}`,
    params
  );

  return rows.map((row) => {
    let detail = row.detail_json;
    if (typeof detail === 'string') {
      try {
        detail = JSON.parse(detail);
      } catch (_) {
        // leave as string
      }
    }
    return { ...row, detail_json: detail };
  });
}

module.exports = {
  create,
  findAll,
};
