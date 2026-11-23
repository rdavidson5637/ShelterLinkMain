'use strict';

/**
 * Shelter memberships (SL-LATER-08).
 * One login can hold a role at more than one sanctuary. Auth and bindShelter
 * still read users.role and users.shelter_id; this model is the table and
 * records layer until those call sites switch over.
 */

const { pool } = require('../config/database');
const { runWithoutShelter } = require('../utils/shelterContext');

const ROLES = Object.freeze(['volunteer', 'staff', 'admin']);

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    shelter_id: Number(row.shelter_id),
    role: row.role,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
    shelter_name: row.shelter_name || null,
    shelter_slug: row.shelter_slug || null,
  };
}

function normaliseRole(role) {
  const value = String(role || '').trim();
  if (!ROLES.includes(value)) {
    const err = new Error('role must be volunteer, staff, or admin');
    err.status = 400;
    throw err;
  }
  return value;
}

function normaliseId(value, label) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error(`Invalid ${label}`);
    err.status = 400;
    throw err;
  }
  return id;
}

async function findForUserAtShelter(userId, shelterId) {
  const uid = normaliseId(userId, 'user id');
  const sid = normaliseId(shelterId, 'shelter id');
  const [rows] = await pool.execute(
    `SELECT m.id, m.user_id, m.shelter_id, m.role, m.created_at, m.updated_at,
            s.name AS shelter_name, s.slug AS shelter_slug
     FROM memberships m
     INNER JOIN shelters s ON s.id = m.shelter_id
     WHERE m.user_id = ? AND m.shelter_id = ?
     LIMIT 1`,
    [uid, sid]
  );
  return mapRow(rows[0]);
}

/**
 * All memberships for a person across sanctuaries. Uses bypass so RLS for a
 * single shelter context does not hide other rows.
 */
async function listForUser(userId) {
  const uid = normaliseId(userId, 'user id');
  return runWithoutShelter(async () => {
    const [rows] = await pool.execute(
      `SELECT m.id, m.user_id, m.shelter_id, m.role, m.created_at, m.updated_at,
              s.name AS shelter_name, s.slug AS shelter_slug
       FROM memberships m
       INNER JOIN shelters s ON s.id = m.shelter_id
       WHERE m.user_id = ?
       ORDER BY s.name ASC, m.id ASC`,
      [uid]
    );
    return rows.map(mapRow);
  });
}

async function listForShelter(shelterId) {
  const sid = normaliseId(shelterId, 'shelter id');
  const [rows] = await pool.execute(
    `SELECT m.id, m.user_id, m.shelter_id, m.role, m.created_at, m.updated_at,
            s.name AS shelter_name, s.slug AS shelter_slug,
            u.first_name, u.last_name, u.email
     FROM memberships m
     INNER JOIN shelters s ON s.id = m.shelter_id
     INNER JOIN users u ON u.user_id = m.user_id
     WHERE m.shelter_id = ?
     ORDER BY u.last_name ASC NULLS LAST, u.first_name ASC NULLS LAST, m.id ASC`,
    [sid]
  );
  return rows.map((row) => ({
    ...mapRow(row),
    first_name: row.first_name || null,
    last_name: row.last_name || null,
    email: row.email || null,
  }));
}

/**
 * Upsert a membership row. Does not change users.shelter_id or users.role.
 */
async function ensure({ userId, shelterId, role }) {
  const uid = normaliseId(userId, 'user id');
  const sid = normaliseId(shelterId, 'shelter id');
  const normalisedRole = normaliseRole(role);

  const [result] = await pool.execute(
    `INSERT INTO memberships (user_id, shelter_id, role)
     VALUES (?, ?, ?)
     ON CONFLICT (user_id, shelter_id) DO UPDATE
       SET role = EXCLUDED.role,
           updated_at = CURRENT_TIMESTAMP`,
    [uid, sid, normalisedRole]
  );

  if (result.insertId) {
    return findForUserAtShelter(uid, sid);
  }
  return findForUserAtShelter(uid, sid);
}

/**
 * Align the primary membership with the user row (same work as the DB trigger).
 * Safe to call after role updates in application code.
 */
async function syncFromUser(user) {
  if (!user || user.shelter_id == null) return null;
  return ensure({
    userId: user.user_id,
    shelterId: user.shelter_id,
    role: user.role,
  });
}

module.exports = {
  ROLES,
  findForUserAtShelter,
  listForUser,
  listForShelter,
  ensure,
  syncFromUser,
  _mapRow: mapRow,
};
