'use strict';

const { pool } = require('../config/database');

const SEVERITIES = new Set(['info', 'concern', 'urgent']);
const VISIBILITIES = new Set(['staff_only']);

function mapIncident(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    animal_id: row.animal_id == null ? null : Number(row.animal_id),
    opportunity_id: row.opportunity_id == null ? null : Number(row.opportunity_id),
    reported_by: Number(row.reported_by),
    body: row.body,
    severity: row.severity,
    visibility: row.visibility || 'staff_only',
    created_at: row.created_at,
    resolved_at: row.resolved_at || null,
    resolved_by: row.resolved_by == null ? null : Number(row.resolved_by),
    animal_name: row.animal_name || null,
    opportunity_title: row.opportunity_title || null,
    reporter_first_name: row.reporter_first_name || null,
    reporter_last_name: row.reporter_last_name || null,
    reporter_name:
      row.reporter_name ||
      [row.reporter_first_name, row.reporter_last_name].filter(Boolean).join(' ').trim() ||
      null,
    resolver_name: row.resolver_name || null,
  };
}

async function create({
  animalId = null,
  opportunityId = null,
  reportedBy,
  body,
  severity = 'concern',
} = {}) {
  if (!reportedBy) {
    const err = new Error('reported_by is required');
    err.status = 400;
    throw err;
  }
  const text = typeof body === 'string' ? body.trim() : '';
  if (!text) {
    const err = new Error('body is required');
    err.status = 400;
    throw err;
  }
  const sev = SEVERITIES.has(severity) ? severity : 'concern';
  if (animalId == null && opportunityId == null) {
    const err = new Error('animal_id or opportunity_id is required');
    err.status = 400;
    throw err;
  }

  const [result] = await pool.execute(
    `
      INSERT INTO incidents
        (animal_id, opportunity_id, reported_by, body, severity, visibility)
      VALUES (?, ?, ?, ?, ?, 'staff_only')
    `,
    [
      animalId == null || animalId === '' ? null : Number(animalId),
      opportunityId == null || opportunityId === '' ? null : Number(opportunityId),
      Number(reportedBy),
      text,
      sev,
    ]
  );
  return findById(result.insertId);
}

async function findById(id) {
  const [rows] = await pool.execute(
    `
      SELECT i.*,
             a.name AS animal_name,
             o.title AS opportunity_title,
             u.first_name AS reporter_first_name,
             u.last_name AS reporter_last_name,
             TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS reporter_name,
             TRIM(CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, ''))) AS resolver_name
      FROM incidents i
      LEFT JOIN animals a ON a.id = i.animal_id
      LEFT JOIN opportunities o ON o.opportunity_id = i.opportunity_id
      LEFT JOIN users u ON u.user_id = i.reported_by
      LEFT JOIN users r ON r.user_id = i.resolved_by
      WHERE i.id = ?
      LIMIT 1
    `,
    [id]
  );
  return mapIncident(rows[0]);
}

async function list({ animalId = null, opportunityId = null, unresolvedOnly = false } = {}) {
  const where = [];
  const params = [];
  if (animalId != null && animalId !== '') {
    where.push('i.animal_id = ?');
    params.push(Number(animalId));
  }
  if (opportunityId != null && opportunityId !== '') {
    where.push('i.opportunity_id = ?');
    params.push(Number(opportunityId));
  }
  if (unresolvedOnly) {
    where.push('i.resolved_at IS NULL');
  }
  const clause = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const [rows] = await pool.execute(
    `
      SELECT i.*,
             a.name AS animal_name,
             o.title AS opportunity_title,
             u.first_name AS reporter_first_name,
             u.last_name AS reporter_last_name,
             TRIM(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) AS reporter_name,
             TRIM(CONCAT(COALESCE(r.first_name, ''), ' ', COALESCE(r.last_name, ''))) AS resolver_name
      FROM incidents i
      LEFT JOIN animals a ON a.id = i.animal_id
      LEFT JOIN opportunities o ON o.opportunity_id = i.opportunity_id
      LEFT JOIN users u ON u.user_id = i.reported_by
      LEFT JOIN users r ON r.user_id = i.resolved_by
      ${clause}
      ORDER BY i.created_at DESC, i.id DESC
    `,
    params
  );
  return rows.map(mapIncident);
}

async function update(id, data = {}) {
  const existing = await findById(id);
  if (!existing) return null;

  const body =
    typeof data.body === 'string' && data.body.trim() ? data.body.trim() : existing.body;
  const severity =
    data.severity && SEVERITIES.has(data.severity) ? data.severity : existing.severity;
  const animalId =
    data.animal_id !== undefined
      ? data.animal_id == null || data.animal_id === ''
        ? null
        : Number(data.animal_id)
      : existing.animal_id;
  const opportunityId =
    data.opportunity_id !== undefined
      ? data.opportunity_id == null || data.opportunity_id === ''
        ? null
        : Number(data.opportunity_id)
      : existing.opportunity_id;

  // Same invariant create() enforces: an incident must stay linked to an
  // animal or a shift, or it silently drops off every list that finds it by
  // one of those ids (e.g. an animal's welfare notes).
  if (animalId == null && opportunityId == null) {
    const err = new Error('animal_id or opportunity_id is required');
    err.status = 400;
    throw err;
  }

  await pool.execute(
    `
      UPDATE incidents
      SET body = ?, severity = ?, animal_id = ?, opportunity_id = ?
      WHERE id = ?
    `,
    [body, severity, animalId, opportunityId, id]
  );
  return findById(id);
}

async function resolve(id, resolvedBy) {
  const [result] = await pool.execute(
    `
      UPDATE incidents
      SET resolved_at = CURRENT_TIMESTAMP, resolved_by = ?
      WHERE id = ? AND resolved_at IS NULL
    `,
    [resolvedBy, id]
  );
  if (!result.affectedRows) {
    const existing = await findById(id);
    if (!existing) return null;
    return existing;
  }
  return findById(id);
}

async function remove(id) {
  const [result] = await pool.execute(`DELETE FROM incidents WHERE id = ?`, [id]);
  return Number(result.affectedRows) > 0;
}

module.exports = {
  SEVERITIES,
  VISIBILITIES,
  mapIncident,
  create,
  findById,
  list,
  update,
  resolve,
  remove,
};
