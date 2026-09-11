'use strict';

const crypto = require('crypto');
const { pool } = require('../config/database');
const VolunteerHours = require('./VolunteerHours');
const Application = require('./Application');

const TABLE = 'certificates';
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function generateCode(length = 12) {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

function mapCertificate(row) {
  if (!row) return null;
  return {
    id: row.id,
    user_id: row.user_id,
    code: row.code,
    issued_at: row.issued_at,
    hours_at_issue: Number(row.hours_at_issue) || 0,
    shifts_at_issue: Number(row.shifts_at_issue) || 0,
    first_name: row.first_name || null,
    last_name: row.last_name || null,
  };
}

async function findById(id) {
  if (!id) return null;
  const [rows] = await pool.execute(
    `
      SELECT c.*, u.first_name, u.last_name
      FROM ${TABLE} c
      INNER JOIN users u ON u.user_id = c.user_id
      WHERE c.id = ?
      LIMIT 1
    `,
    [Number(id)]
  );
  return mapCertificate(rows[0] || null);
}

async function findLatestByUserId(userId) {
  if (!userId) return null;
  const [rows] = await pool.execute(
    `
      SELECT c.*, u.first_name, u.last_name
      FROM ${TABLE} c
      INNER JOIN users u ON u.user_id = c.user_id
      WHERE c.user_id = ?
      ORDER BY c.issued_at DESC, c.id DESC
      LIMIT 1
    `,
    [Number(userId)]
  );
  return mapCertificate(rows[0] || null);
}

async function findByCode(code) {
  if (!code) return null;
  const normalized = String(code).trim().toUpperCase();
  if (!normalized) return null;
  const [rows] = await pool.execute(
    `
      SELECT c.*, u.first_name, u.last_name
      FROM ${TABLE} c
      INNER JOIN users u ON u.user_id = c.user_id
      WHERE c.code = ?
      LIMIT 1
    `,
    [normalized]
  );
  return mapCertificate(rows[0] || null);
}

/**
 * Issue a certificate snapshot of current approved hours + shifts.
 */
async function issueForUser(userId) {
  if (!userId) throw new Error('userId is required');

  const [hoursRaw, shiftsRaw] = await Promise.all([
    VolunteerHours.getTotalHours(userId),
    Application.countApprovedByUserId(userId),
  ]);
  const hours = Number(hoursRaw) || 0;
  const shifts = Number(shiftsRaw) || 0;

  let lastError = null;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = generateCode(12);
    try {
      const [result] = await pool.execute(
        `
          INSERT INTO ${TABLE} (user_id, code, hours_at_issue, shifts_at_issue)
          VALUES (?, ?, ?, ?)
        `,
        [Number(userId), code, hours, shifts]
      );
      return findById(result.insertId);
    } catch (error) {
      lastError = error;
      // Unique violation — retry with a new code
      if (error && (error.code === '23505' || /unique/i.test(error.message || ''))) {
        continue;
      }
      throw error;
    }
  }
  throw lastError || new Error('Unable to allocate certificate code');
}

module.exports = {
  generateCode,
  findById,
  findLatestByUserId,
  findByCode,
  issueForUser,
};
