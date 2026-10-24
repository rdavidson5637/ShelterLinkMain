'use strict';

const { passwordPolicyError, hashPassword } = require('../utils/password');
const { sniffImage, canonicalMime } = require('../utils/fileSignature');
const { pool } = require('../config/database');
const { runWithShelter, runWithoutShelter } = require('../utils/shelterContext');
const { assertLiveWriteAllowed } = require('../utils/liveDbGuard');

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGO_TYPES = new Set(['image/jpeg', 'image/png']);
const MAX_LOGO_BYTES = 512 * 1024;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

async function assertPassword(password) {
  const policyError = await passwordPolicyError(password);
  if (policyError) throw fail(400, policyError);
}

function splitName(adminName) {
  const parts = String(adminName || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) throw fail(400, 'Admin name is required');
  const first = parts.shift();
  const last = parts.join(' ');
  return { first, last, full: [first, last].filter(Boolean).join(' ') };
}

function guardLive() {
  assertLiveWriteAllowed(process.env.DATABASE_URL, process.env.CONFIRM_LIVE_SHELTER);
}

async function createShelterWithAdmin({
  name,
  slug,
  adminName,
  adminEmail,
  adminPassword,
  logo = null,
  logoMime = null,
} = {}) {
  guardLive();
  const shelterName = String(name || '').trim();
  const shelterSlug = String(slug || '').trim().toLowerCase();
  const email = String(adminEmail || '').trim().toLowerCase();
  if (shelterName.length < 2 || shelterName.length > 255) {
    throw fail(400, 'Shelter name must be 2 to 255 characters');
  }
  if (!SLUG_RE.test(shelterSlug)) {
    throw fail(400, 'Slug must be lowercase letters, numbers, and single hyphens');
  }
  if (!EMAIL_RE.test(email)) throw fail(400, 'Admin email is invalid');
  await assertPassword(adminPassword);
  if (logo) {
    const detected = sniffImage(logo);
    if (!detected || detected !== canonicalMime(logoMime) || logo.length > MAX_LOGO_BYTES) {
      throw fail(400, 'Logo must be a PNG or JPEG under 512KB');
    }
  }

  const { first, last, full } = splitName(adminName);
  const [existingEmail] = await runWithoutShelter(() => pool.execute(
    'SELECT user_id FROM users WHERE lower(email) = lower(?)',
    [email]
  ));
  if (existingEmail.length) throw fail(409, 'Email already in use');

  const [existingSlug] = await runWithoutShelter(() => pool.execute(
    'SELECT id FROM shelters WHERE slug = ? LIMIT 1',
    [shelterSlug]
  ));
  if (existingSlug.length) throw fail(409, 'Slug already in use');

  const passwordHash = await hashPassword(adminPassword);
  const [created] = await runWithoutShelter(() => pool.execute(
    `INSERT INTO shelters (name, slug, logo, logo_mime)
     VALUES (?, ?, ?, ?)`,
    [shelterName, shelterSlug, logo, logo ? logoMime : null]
  ));
  const shelterId = Number(created.insertId || (created[0] && created[0].id));
  if (!shelterId) throw fail(500, 'Shelter was not created');

  await runWithShelter(shelterId, () => pool.execute(
    `INSERT INTO users (first_name, last_name, name, email, password, role, created_at)
     VALUES (?, ?, ?, ?, ?, 'admin', NOW())`,
    [first, last, full, email, passwordHash]
  ));

  return { shelterId, name: shelterName, slug: shelterSlug, adminEmail: email };
}

async function updateShelterBrand({ slug, name, logo = null, logoMime = null } = {}) {
  guardLive();
  const shelterSlug = String(slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(shelterSlug)) throw fail(400, 'Slug is invalid');
  const shelterName = name == null ? null : String(name).trim();
  if (shelterName != null && (shelterName.length < 2 || shelterName.length > 255)) {
    throw fail(400, 'Shelter name must be 2 to 255 characters');
  }
  if (logo) {
    const detected = sniffImage(logo);
    if (!detected || detected !== canonicalMime(logoMime) || logo.length > MAX_LOGO_BYTES) {
      throw fail(400, 'Logo must be a PNG or JPEG under 512KB');
    }
  }
  if (shelterName == null && !logo) throw fail(400, 'Pass a new name, a logo, or both');

  const [rows] = await runWithoutShelter(() => pool.execute(
    'SELECT id FROM shelters WHERE slug = ? LIMIT 1',
    [shelterSlug]
  ));
  if (!rows.length) throw fail(404, 'Shelter not found');

  if (shelterName != null && logo) {
    await runWithoutShelter(() => pool.execute(
      'UPDATE shelters SET name = ?, logo = ?, logo_mime = ? WHERE slug = ?',
      [shelterName, logo, logoMime, shelterSlug]
    ));
  } else if (logo) {
    await runWithoutShelter(() => pool.execute(
      'UPDATE shelters SET logo = ?, logo_mime = ? WHERE slug = ?',
      [logo, logoMime, shelterSlug]
    ));
  } else {
    await runWithoutShelter(() => pool.execute(
      'UPDATE shelters SET name = ? WHERE slug = ?',
      [shelterName, shelterSlug]
    ));
  }
  return { slug: shelterSlug, name: shelterName };
}

module.exports = {
  createShelterWithAdmin,
  updateShelterBrand,
  LOGO_TYPES,
  MAX_LOGO_BYTES,
};
