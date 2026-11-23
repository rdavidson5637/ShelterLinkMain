'use strict';

const { pool } = require('../config/database');

const LIST_MAX = 100;
const EXPORT_MAX = 10000;

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

function buildFilters(filters = {}) {
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

  return {
    whereSql: where.length ? `WHERE ${where.join(' AND ')}` : '',
    params,
  };
}

function parseDetail(detail) {
  if (typeof detail !== 'string') return detail;
  try {
    return JSON.parse(detail);
  } catch (_) {
    return detail;
  }
}

function mapRow(row) {
  return { ...row, detail_json: parseDetail(row.detail_json) };
}

/**
 * List audit rows with optional filters.
 * @param {{ action?: string, entityType?: string, userId?: number, from?: string, to?: string, limit?: number, offset?: number, forExport?: boolean }} filters
 * @returns {Promise<{ rows: object[], total: number, limit: number, offset: number }>}
 */
async function findAll(filters = {}) {
  const { whereSql, params } = buildFilters(filters);
  const forExport = Boolean(filters.forExport);
  const max = forExport ? EXPORT_MAX : LIST_MAX;
  const defaultLimit = forExport ? EXPORT_MAX : 50;
  const limit = Math.min(Math.max(Number(filters.limit) || defaultLimit, 1), max);
  const offset = Math.max(Number(filters.offset) || 0, 0);

  const [countRows] = await pool.execute(
    `SELECT COUNT(*)::int AS total
     FROM audit_log a
     ${whereSql}`,
    params
  );
  const total = Number(countRows[0]?.total || 0);

  const [rows] = await pool.execute(
    `SELECT
       a.id,
       a.user_id,
       a.shelter_id,
       a.action,
       a.entity_type,
       a.entity_id,
       a.detail_json,
       a.created_at,
       u.email AS actor_email,
       u.first_name AS actor_first_name,
       u.last_name AS actor_last_name,
       u.role AS actor_role,
       s.name AS shelter_name,
       s.slug AS shelter_slug
     FROM audit_log a
     LEFT JOIN users u ON u.user_id = a.user_id
     LEFT JOIN shelters s ON s.id = a.shelter_id
     ${whereSql}
     ORDER BY a.created_at DESC, a.id DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    rows: rows.map(mapRow),
    total,
    limit,
    offset,
  };
}

module.exports = {
  create,
  findAll,
  LIST_MAX,
  EXPORT_MAX,
};
