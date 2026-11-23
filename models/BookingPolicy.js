'use strict';

/**
 * Per-shelter booking mode and the staff-granted trusted flag (SL-NOW-03).
 * See database/044_booking_policy.pg.sql and utils/bookingPolicy.js.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');
const { normaliseMode, isValidMode, DEFAULT_MODE } = require('../utils/bookingPolicy');

function requireShelterId() {
  const shelterId = currentShelterId();
  if (!shelterId) {
    const err = new Error('Shelter context is missing');
    err.status = 403;
    throw err;
  }
  return shelterId;
}

// Always name the shelter row. Row level security is a second guard.
async function getPolicy() {
  const shelterId = currentShelterId();
  if (!shelterId) return { booking_mode: DEFAULT_MODE, updated_at: null };
  const [rows] = await pool.execute(
    `SELECT booking_mode, updated_at
       FROM shelter_booking_policy
      WHERE shelter_id = ?
      LIMIT 1`,
    [shelterId]
  );
  const row = rows[0] || null;
  return {
    booking_mode: normaliseMode(row ? row.booking_mode : null),
    updated_at: row ? row.updated_at : null,
  };
}

async function getMode() {
  return (await getPolicy()).booking_mode;
}

async function setMode(mode, updatedBy) {
  if (!isValidMode(mode)) {
    const err = new Error('booking_mode must be approval or instant');
    err.status = 400;
    throw err;
  }
  const shelterId = requireShelterId();
  await pool.execute(
    `INSERT INTO shelter_booking_policy (shelter_id, booking_mode, updated_by, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (shelter_id) DO UPDATE
       SET booking_mode = EXCLUDED.booking_mode,
           updated_by = EXCLUDED.updated_by,
           updated_at = CURRENT_TIMESTAMP`,
    [shelterId, mode, updatedBy || null]
  );
  return getPolicy();
}

async function isTrusted(userId) {
  const shelterId = currentShelterId();
  if (!shelterId || !userId) return false;
  const [rows] = await pool.execute(
    `SELECT user_id
       FROM trusted_volunteers
      WHERE shelter_id = ? AND user_id = ?
      LIMIT 1`,
    [shelterId, userId]
  );
  return rows.length > 0;
}

async function listTrusted() {
  const shelterId = currentShelterId();
  if (!shelterId) return [];
  const [rows] = await pool.execute(
    `SELECT t.user_id, t.granted_at, t.granted_by,
            u.first_name, u.last_name, u.name, u.email
       FROM trusted_volunteers t
       JOIN users u ON u.user_id = t.user_id
      WHERE t.shelter_id = ?
      ORDER BY u.last_name ASC, u.first_name ASC, t.user_id ASC`,
    [shelterId]
  );
  return rows;
}

async function grantTrust(userId, grantedBy) {
  if (!userId) throw new Error('userId is required');
  const shelterId = requireShelterId();
  await pool.execute(
    `INSERT INTO trusted_volunteers (shelter_id, user_id, granted_by, granted_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (shelter_id, user_id) DO NOTHING`,
    [shelterId, userId, grantedBy || null]
  );
  return true;
}

async function revokeTrust(userId) {
  if (!userId) throw new Error('userId is required');
  const shelterId = requireShelterId();
  const [result] = await pool.execute(
    `DELETE FROM trusted_volunteers WHERE shelter_id = ? AND user_id = ?`,
    [shelterId, userId]
  );
  return Boolean(result && result.affectedRows);
}

module.exports = {
  getPolicy,
  getMode,
  setMode,
  isTrusted,
  listTrusted,
  grantTrust,
  revokeTrust,
};
