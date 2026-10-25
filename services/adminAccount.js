'use strict';

const { passwordPolicyError, hashPassword } = require('../utils/password');
const { pool } = require('../config/database');
const { runWithShelter, runWithoutShelter } = require('../utils/shelterContext');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function splitName(adminName) {
  const parts = String(adminName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) throw fail(400, 'Admin name is required');
  const first = parts.shift();
  const last = parts.join(' ');
  return { first, last, full: [first, last].filter(Boolean).join(' ') };
}

async function resolveShelter(shelterSlug) {
  const [rows] = await runWithoutShelter(() => pool.execute(
    'SELECT id, slug, name FROM shelters ORDER BY id'
  ));
  const wanted = String(shelterSlug || '').trim().toLowerCase();
  if (wanted) {
    const match = rows.filter((row) => String(row.slug) === wanted);
    if (match.length !== 1) throw fail(404, 'Shelter not found');
    return match[0];
  }
  if (rows.length === 1) return rows[0];
  if (!rows.length) {
    throw fail(400, 'No shelter exists. Create one with scripts/create-shelter.js first.');
  }
  throw fail(400, 'More than one shelter exists. Pass --shelter and its slug.');
}

/**
 * Create an admin on an existing shelter. A shelterless user cannot sign in:
 * the session is rejected when users.shelter_id is missing.
 */
async function createAdminAccount({ name, email, password, shelterSlug } = {}) {
  const policyError = await passwordPolicyError(password);
  if (policyError) throw fail(400, policyError);

  const normalizedEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(normalizedEmail)) throw fail(400, 'Admin email is invalid');

  const shelter = await resolveShelter(shelterSlug);
  const { first, last, full } = splitName(name);

  const [existing] = await runWithoutShelter(() => pool.execute(
    'SELECT user_id FROM users WHERE lower(email) = lower(?)',
    [normalizedEmail]
  ));
  if (existing.length > 1) throw fail(409, 'That email matches more than one account');
  if (existing.length === 1) throw fail(409, 'Email already in use');

  const passwordHash = await hashPassword(password);
  const shelterId = Number(shelter.id);
  const [created] = await runWithShelter(shelterId, () => pool.execute(
    `INSERT INTO users (first_name, last_name, name, email, password, role, shelter_id, created_at)
     VALUES (?, ?, ?, ?, ?, 'admin', ?, NOW())`,
    [first, last, full, normalizedEmail, passwordHash, shelterId]
  ));
  const userId = Number(created.insertId || (created[0] && created[0].user_id));
  if (!userId) throw fail(500, 'Admin was not created');

  return {
    userId,
    shelterId,
    slug: shelter.slug,
    email: normalizedEmail,
  };
}

module.exports = {
  createAdminAccount,
};
