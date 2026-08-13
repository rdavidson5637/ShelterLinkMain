'use strict';

const { pool } = require('../config/database');

/**
 * Compute expires_at from awarded_at + validity_months.
 * Returns null when validityMonths is null/empty (never expires).
 */
function computeExpiresAt(awardedAt, validityMonths) {
  if (validityMonths === null || validityMonths === undefined || validityMonths === '') {
    return null;
  }
  const months = Number(validityMonths);
  if (!Number.isFinite(months) || months <= 0) {
    return null;
  }

  const raw = String(awardedAt).slice(0, 10);
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) {
    throw new Error('Invalid awarded_at date');
  }

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month, day));
  date.setUTCMonth(date.getUTCMonth() + months);
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function toDateOnly(value) {
  if (!value) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return null;
    return value.toISOString().slice(0, 10);
  }
  return String(value).slice(0, 10);
}

/**
 * Pure helper: given required quals and held awards, return missing/expired names.
 * required: [{ id, name }]
 * held: [{ qualification_id, expires_at }]
 * asOf: Date or date string (compared as YYYY-MM-DD)
 */
function findMissingOrExpired(required = [], held = [], asOf = new Date()) {
  const asOfDay = toDateOnly(asOf);
  const heldById = new Map();
  for (const row of held) {
    heldById.set(Number(row.qualification_id), row);
  }

  const missing = [];
  for (const req of required) {
    const id = Number(req.id ?? req.qualification_id);
    const award = heldById.get(id);
    if (!award) {
      missing.push({ id, name: req.name, reason: 'missing' });
      continue;
    }
    const expires = toDateOnly(award.expires_at);
    if (expires && asOfDay && expires < asOfDay) {
      missing.push({ id, name: req.name, reason: 'expired' });
    }
  }
  return missing;
}

function mapQualification(row) {
  if (!row) return null;
  return {
    ...row,
    id: row.id,
  };
}

async function create({ name, description = null, validity_months = null }) {
  const sql = `
    INSERT INTO qualifications (name, description, validity_months)
    VALUES (?, ?, ?)
  `;
  const months =
    validity_months === null || validity_months === undefined || validity_months === ''
      ? null
      : Number(validity_months);
  const [result] = await pool.execute(sql, [
    name,
    description || null,
    Number.isFinite(months) ? months : null,
  ]);
  return findById(result.insertId);
}

async function findById(id) {
  const [rows] = await pool.execute(
    `SELECT id, name, description, validity_months, created_at
     FROM qualifications WHERE id = ? LIMIT 1`,
    [id]
  );
  return mapQualification(rows[0] || null);
}

async function findAll() {
  const [rows] = await pool.execute(
    `SELECT id, name, description, validity_months, created_at
     FROM qualifications
     ORDER BY name ASC`
  );
  return rows.map(mapQualification);
}

async function update(id, data = {}) {
  const fields = [];
  const params = [];

  if (typeof data.name !== 'undefined') {
    fields.push('name = ?');
    params.push(data.name);
  }
  if (typeof data.description !== 'undefined') {
    fields.push('description = ?');
    params.push(data.description || null);
  }
  if (typeof data.validity_months !== 'undefined') {
    fields.push('validity_months = ?');
    const months =
      data.validity_months === null || data.validity_months === ''
        ? null
        : Number(data.validity_months);
    params.push(Number.isFinite(months) ? months : null);
  }

  if (!fields.length) {
    throw new Error('No qualification fields provided for update');
  }

  params.push(id);
  const [result] = await pool.execute(
    `UPDATE qualifications SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
  if (!result.affectedRows) return null;
  return findById(id);
}

async function remove(id) {
  const [result] = await pool.execute(`DELETE FROM qualifications WHERE id = ?`, [id]);
  return result.affectedRows > 0;
}

async function findRequiredForOpportunity(opportunityId) {
  const sql = `
    SELECT q.id, q.name, q.description, q.validity_months
    FROM opportunity_qualifications oq
    INNER JOIN qualifications q ON q.id = oq.qualification_id
    WHERE oq.opportunity_id = ?
    ORDER BY q.name ASC
  `;
  const [rows] = await pool.execute(sql, [opportunityId]);
  return rows;
}

async function setRequiredForOpportunity(opportunityId, qualificationIds = []) {
  await pool.execute(
    `DELETE FROM opportunity_qualifications WHERE opportunity_id = ?`,
    [opportunityId]
  );

  const ids = [...new Set(
    (qualificationIds || [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
  )];

  for (const qid of ids) {
    await pool.execute(
      `INSERT INTO opportunity_qualifications (opportunity_id, qualification_id) VALUES (?, ?)`,
      [opportunityId, qid]
    );
  }

  return findRequiredForOpportunity(opportunityId);
}

/**
 * Attach required_qualifications arrays onto a list of opportunity rows.
 */
async function attachRequiredQualifications(opportunities = []) {
  if (!opportunities.length) return opportunities;

  const ids = opportunities
    .map((o) => o.opportunity_id || o.id)
    .filter(Boolean);
  if (!ids.length) return opportunities;

  const placeholders = ids.map(() => '?').join(', ');
  const sql = `
    SELECT oq.opportunity_id, q.id, q.name, q.description, q.validity_months
    FROM opportunity_qualifications oq
    INNER JOIN qualifications q ON q.id = oq.qualification_id
    WHERE oq.opportunity_id IN (${placeholders})
    ORDER BY q.name ASC
  `;
  const [rows] = await pool.execute(sql, ids);
  const byOpp = new Map();
  for (const row of rows) {
    const list = byOpp.get(row.opportunity_id) || [];
    list.push({
      id: row.id,
      name: row.name,
      description: row.description,
      validity_months: row.validity_months,
    });
    byOpp.set(row.opportunity_id, list);
  }

  return opportunities.map((opp) => {
    const oid = opp.opportunity_id || opp.id;
    return {
      ...opp,
      required_qualifications: byOpp.get(oid) || [],
    };
  });
}

async function findByUserId(userId) {
  const sql = `
    SELECT
      vq.id,
      vq.user_id,
      vq.qualification_id,
      vq.awarded_at,
      vq.expires_at,
      vq.awarded_by,
      vq.last_expiry_notified_at,
      q.name,
      q.description,
      q.validity_months
    FROM volunteer_qualifications vq
    INNER JOIN qualifications q ON q.id = vq.qualification_id
    WHERE vq.user_id = ?
    ORDER BY q.name ASC
  `;
  const [rows] = await pool.execute(sql, [userId]);
  return rows;
}

async function awardToUser({
  userId,
  qualificationId,
  awardedAt,
  awardedBy = null,
  asOf = new Date(),
}) {
  const qualification = await findById(qualificationId);
  if (!qualification) {
    const err = new Error('Qualification not found');
    err.status = 404;
    throw err;
  }

  const awarded = toDateOnly(awardedAt) || toDateOnly(asOf);
  const expiresAt = computeExpiresAt(awarded, qualification.validity_months);

  const sql = `
    INSERT INTO volunteer_qualifications
      (user_id, qualification_id, awarded_at, expires_at, awarded_by, last_expiry_notified_at)
    VALUES (?, ?, ?, ?, ?, NULL)
    ON DUPLICATE KEY UPDATE
      awarded_at = VALUES(awarded_at),
      expires_at = VALUES(expires_at),
      awarded_by = VALUES(awarded_by),
      last_expiry_notified_at = NULL
  `;
  await pool.execute(sql, [
    userId,
    qualificationId,
    awarded,
    expiresAt,
    awardedBy,
  ]);

  const held = await findByUserId(userId);
  return held.find((row) => Number(row.qualification_id) === Number(qualificationId)) || null;
}

async function revokeFromUser(userId, qualificationId) {
  const [result] = await pool.execute(
    `DELETE FROM volunteer_qualifications WHERE user_id = ? AND qualification_id = ?`,
    [userId, qualificationId]
  );
  return result.affectedRows > 0;
}

/**
 * Return required qualifications the volunteer is missing or has expired.
 */
async function findMissingForUser(userId, opportunityId, asOf = new Date()) {
  const required = await findRequiredForOpportunity(opportunityId);
  if (!required.length) return [];

  const held = await findByUserId(userId);
  return findMissingOrExpired(required, held, asOf);
}

/**
 * Rows needing a 30-day-before expiry email (idempotent via last_expiry_notified_at).
 */
async function findNeedingExpiryWarning(now = new Date()) {
  const today = toDateOnly(now);
  const sql = `
    SELECT
      vq.id AS volunteer_qualification_id,
      vq.user_id,
      vq.qualification_id,
      vq.awarded_at,
      vq.expires_at,
      vq.last_expiry_notified_at,
      q.name AS qualification_name,
      u.email,
      u.first_name,
      u.last_name
    FROM volunteer_qualifications vq
    INNER JOIN qualifications q ON q.id = vq.qualification_id
    INNER JOIN users u ON u.user_id = vq.user_id
    WHERE vq.expires_at = DATE_ADD(?, INTERVAL 30 DAY)
      AND (
        vq.last_expiry_notified_at IS NULL
        OR vq.last_expiry_notified_at < DATE_SUB(vq.expires_at, INTERVAL 30 DAY)
      )
  `;
  const [rows] = await pool.execute(sql, [today]);
  return rows;
}

/**
 * Rows needing an "expired today" email (idempotent via last_expiry_notified_at).
 */
async function findNeedingExpiryNotice(now = new Date()) {
  const today = toDateOnly(now);
  const sql = `
    SELECT
      vq.id AS volunteer_qualification_id,
      vq.user_id,
      vq.qualification_id,
      vq.awarded_at,
      vq.expires_at,
      vq.last_expiry_notified_at,
      q.name AS qualification_name,
      u.email,
      u.first_name,
      u.last_name
    FROM volunteer_qualifications vq
    INNER JOIN qualifications q ON q.id = vq.qualification_id
    INNER JOIN users u ON u.user_id = vq.user_id
    WHERE vq.expires_at = ?
      AND (
        vq.last_expiry_notified_at IS NULL
        OR vq.last_expiry_notified_at < vq.expires_at
      )
  `;
  const [rows] = await pool.execute(sql, [today]);
  return rows;
}

async function markExpiryNotified(volunteerQualificationId, notifiedAt) {
  const day = toDateOnly(notifiedAt);
  const [result] = await pool.execute(
    `UPDATE volunteer_qualifications
     SET last_expiry_notified_at = ?
     WHERE id = ?`,
    [day, volunteerQualificationId]
  );
  return result.affectedRows > 0;
}

module.exports = {
  computeExpiresAt,
  findMissingOrExpired,
  toDateOnly,
  create,
  findById,
  findAll,
  update,
  remove,
  findRequiredForOpportunity,
  setRequiredForOpportunity,
  attachRequiredQualifications,
  findByUserId,
  awardToUser,
  revokeFromUser,
  findMissingForUser,
  findNeedingExpiryWarning,
  findNeedingExpiryNotice,
  markExpiryNotified,
};
