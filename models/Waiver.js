'use strict';

const { pool } = require('../config/database');

function mapWaiver(row) {
  if (!row) return null;
  return {
    ...row,
    active: Boolean(row.active),
    requires_reacceptance: Boolean(row.requires_reacceptance),
  };
}

async function create({
  title,
  body,
  active = true,
  requires_reacceptance = true,
}) {
  const sql = `
    INSERT INTO waivers (title, body, version, active, requires_reacceptance)
    VALUES (?, ?, 1, ?, ?)
  `;
  const [result] = await pool.execute(sql, [
    title,
    body,
    active ? 1 : 0,
    requires_reacceptance ? 1 : 0,
  ]);
  return findById(result.insertId);
}

async function findById(id) {
  const [rows] = await pool.execute(
    `SELECT id, title, body, version, active, requires_reacceptance, created_at
     FROM waivers WHERE id = ? LIMIT 1`,
    [id]
  );
  return mapWaiver(rows[0] || null);
}

async function findAll() {
  const [rows] = await pool.execute(
    `SELECT id, title, body, version, active, requires_reacceptance, created_at
     FROM waivers
     ORDER BY active DESC, title ASC`
  );
  return rows.map(mapWaiver);
}

async function findActive() {
  const [rows] = await pool.execute(
    `SELECT id, title, body, version, active, requires_reacceptance, created_at
     FROM waivers
     WHERE active = 1
     ORDER BY title ASC`
  );
  return rows.map(mapWaiver);
}

/**
 * Update waiver content. Editing title/body bumps version.
 * When requires_reacceptance is true, volunteers must accept the new version.
 */
async function update(id, data = {}) {
  const existing = await findById(id);
  if (!existing) return null;

  const title = typeof data.title !== 'undefined' ? data.title : existing.title;
  const body = typeof data.body !== 'undefined' ? data.body : existing.body;
  const active =
    typeof data.active !== 'undefined' ? Boolean(data.active) : existing.active;
  const requires_reacceptance =
    typeof data.requires_reacceptance !== 'undefined'
      ? Boolean(data.requires_reacceptance)
      : existing.requires_reacceptance;

  const contentChanged =
    title !== existing.title || body !== existing.body;
  const version = contentChanged ? Number(existing.version) + 1 : Number(existing.version);

  await pool.execute(
    `UPDATE waivers
     SET title = ?, body = ?, version = ?, active = ?, requires_reacceptance = ?
     WHERE id = ?`,
    [
      title,
      body,
      version,
      active ? 1 : 0,
      requires_reacceptance ? 1 : 0,
      id,
    ]
  );
  return findById(id);
}

/**
 * Active waivers the user has not accepted at a valid version.
 * - requires_reacceptance=1: must have acceptance for the current version
 * - requires_reacceptance=0: any prior acceptance of this waiver still counts
 */
async function findPendingForUser(userId) {
  const sql = `
    SELECT w.id, w.title, w.body, w.version, w.active, w.requires_reacceptance, w.created_at
    FROM waivers w
    WHERE w.active = 1
      AND NOT EXISTS (
        SELECT 1
        FROM waiver_acceptances wa
        WHERE wa.waiver_id = w.id
          AND wa.user_id = ?
          AND (
            wa.version = w.version
            OR w.requires_reacceptance = 0
          )
      )
    ORDER BY w.title ASC
  `;
  const [rows] = await pool.execute(sql, [userId]);
  return rows.map(mapWaiver);
}

async function hasPendingForUser(userId) {
  const pending = await findPendingForUser(userId);
  return pending.length > 0;
}

async function accept({ waiverId, userId, version }) {
  const sql = `
    INSERT INTO waiver_acceptances (waiver_id, user_id, version)
    VALUES (?, ?, ?)
  `;
  const [result] = await pool.execute(sql, [waiverId, userId, version]);
  const [rows] = await pool.execute(
    `SELECT id, waiver_id, user_id, version, accepted_at
     FROM waiver_acceptances WHERE id = ? LIMIT 1`,
    [result.insertId]
  );
  return rows[0] || null;
}

/**
 * Waiver status summary for a volunteer (admin view).
 */
async function getStatusForUser(userId) {
  const sql = `
    SELECT
      w.id,
      w.title,
      w.version AS current_version,
      w.active,
      w.requires_reacceptance,
      (
        SELECT wa.version
        FROM waiver_acceptances wa
        WHERE wa.waiver_id = w.id AND wa.user_id = ?
        ORDER BY wa.version DESC
        LIMIT 1
      ) AS accepted_version,
      (
        SELECT wa.accepted_at
        FROM waiver_acceptances wa
        WHERE wa.waiver_id = w.id AND wa.user_id = ?
        ORDER BY wa.version DESC
        LIMIT 1
      ) AS accepted_at
    FROM waivers w
    WHERE w.active = 1
    ORDER BY w.title ASC
  `;
  const [rows] = await pool.execute(sql, [userId, userId]);
  return rows.map((row) => {
    const acceptedVersion = row.accepted_version == null ? null : Number(row.accepted_version);
    const currentVersion = Number(row.current_version);
    const requiresRe = Boolean(row.requires_reacceptance);
    let status = 'pending';
    if (acceptedVersion != null) {
      if (acceptedVersion === currentVersion || !requiresRe) {
        status = 'accepted';
      } else {
        status = 'needs_reacceptance';
      }
    }
    return {
      id: row.id,
      title: row.title,
      current_version: currentVersion,
      accepted_version: acceptedVersion,
      accepted_at: row.accepted_at || null,
      requires_reacceptance: requiresRe,
      status,
    };
  });
}

module.exports = {
  create,
  findById,
  findAll,
  findActive,
  update,
  findPendingForUser,
  hasPendingForUser,
  accept,
  getStatusForUser,
};
