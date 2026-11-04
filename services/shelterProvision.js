'use strict';

const crypto = require('crypto');
const { passwordPolicyError, hashPassword } = require('../utils/password');
const { sniffImage, canonicalMime } = require('../utils/fileSignature');
const { pool } = require('../config/database');
const { runWithShelter, runWithoutShelter } = require('../utils/shelterContext');
const { assertLiveWriteAllowed } = require('../utils/liveDbGuard');

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const LOGO_TYPES = new Set(['image/jpeg', 'image/png']);
const MAX_LOGO_BYTES = 512 * 1024;
const REGULATORS = new Set(['ccew', 'oscr', 'ccni', 'cri']);
const INVITE_ROLES = new Set(['admin', 'staff']);
const INVITE_TOKEN_BYTES = 32;
const INVITE_TTL_DAYS = 7;

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

function normaliseShelterName(name) {
  const shelterName = String(name || '').trim();
  if (shelterName.length < 2 || shelterName.length > 255) {
    throw fail(400, 'Shelter name must be 2 to 255 characters');
  }
  return shelterName;
}

function normaliseSlug(slug) {
  const shelterSlug = String(slug || '').trim().toLowerCase();
  if (!SLUG_RE.test(shelterSlug)) {
    throw fail(400, 'Slug must be lowercase letters, numbers, and single hyphens');
  }
  return shelterSlug;
}

/**
 * Insert one shelter row. No users are created here.
 *
 * `db` is the pool or a connection from pool.getConnection(), so the caller
 * can run this inside its own transaction. The caller sets the shelter
 * context (runWithoutShelter): shelters is not tenant scoped for writes.
 * The shelter id always comes from the insert, never from a client.
 */
async function createShelter(db, {
  name,
  slug,
  logo = null,
  logoMime = null,
  charityRegulator = null,
  charityNumber = null,
  charityRegisterName = null,
  charityCheckedAt = null,
} = {}) {
  const shelterName = normaliseShelterName(name);
  const shelterSlug = normaliseSlug(slug);
  if ((charityRegulator == null) !== (charityNumber == null)) {
    throw fail(400, 'Charity regulator and number go together');
  }
  if (charityRegulator != null && !REGULATORS.has(charityRegulator)) {
    throw fail(400, 'Charity regulator is invalid');
  }

  const [existingSlug] = await db.execute(
    'SELECT id FROM shelters WHERE slug = ? LIMIT 1',
    [shelterSlug]
  );
  if (existingSlug.length) throw fail(409, 'Slug already in use');

  if (charityRegulator != null) {
    const [existingCharity] = await db.execute(
      'SELECT id FROM shelters WHERE charity_regulator = ? AND charity_number = ? LIMIT 1',
      [charityRegulator, charityNumber]
    );
    if (existingCharity.length) throw fail(409, 'This charity already has a shelter');
  }

  let created;
  try {
    [created] = await db.execute(
      `INSERT INTO shelters
         (name, slug, logo, logo_mime, charity_regulator, charity_number,
          charity_register_name, charity_checked_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       RETURNING id`,
      [
        shelterName,
        shelterSlug,
        logo,
        logo ? logoMime : null,
        charityRegulator,
        charityNumber,
        charityRegisterName,
        charityCheckedAt,
      ]
    );
  } catch (error) {
    if (error && error.code === '23505') throw fail(409, 'Slug or charity already in use');
    throw error;
  }
  const shelterId = Number(created.insertId || (created[0] && created[0].id));
  if (!shelterId) throw fail(500, 'Shelter was not created');
  return { shelterId, name: shelterName, slug: shelterSlug };
}

function hashInviteToken(token) {
  return crypto.createHash('sha256').update(String(token)).digest('hex');
}

/**
 * Issue a one-time invite for a shelter. Returns the raw token once; only
 * its SHA-256 hash is stored. The invite expires after 7 days and is single
 * use (see consumeInvite). No password is set here and nothing is emailed.
 *
 * Like createShelter, `db` may be a transaction connection. shelter_id is
 * written explicitly because a platform owner runs outside any shelter
 * context. created_by is optional: the same-shelter trigger on
 * admin_invites requires it to be a user of the invited shelter.
 */
async function createInvite(db, { shelterId, email, role = 'admin', createdBy = null } = {}) {
  const id = Number(shelterId);
  if (!Number.isInteger(id) || id <= 0) throw fail(400, 'Shelter is required');
  const inviteEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(inviteEmail) || inviteEmail.length > 255) throw fail(400, 'Invite email is invalid');
  if (!INVITE_ROLES.has(role)) throw fail(400, 'Invite role is invalid');

  const token = crypto.randomBytes(INVITE_TOKEN_BYTES).toString('base64url');
  const tokenHash = hashInviteToken(token);
  const [rows] = await db.execute(
    `INSERT INTO admin_invites (shelter_id, email, token_hash, role, expires_at, created_by)
     VALUES (?, ?, ?, ?, NOW() + INTERVAL '${INVITE_TTL_DAYS} days', ?)
     RETURNING id, expires_at`,
    [id, inviteEmail, tokenHash, role, createdBy]
  );
  const row = rows[0] || {};
  const inviteId = Number(rows.insertId || row.id);
  if (!inviteId) throw fail(500, 'Invite was not created');
  return { inviteId, token, email: inviteEmail, role, expiresAt: row.expires_at || null };
}

/**
 * Mark an invite used, once. Returns the invite row, or null when the token
 * is unknown, expired, or already used. A single UPDATE makes reuse
 * impossible even when two requests race.
 */
async function consumeInvite(db, token) {
  if (typeof token !== 'string' || !token) return null;
  const [rows] = await db.execute(
    `UPDATE admin_invites SET used_at = NOW()
     WHERE token_hash = ? AND used_at IS NULL AND expires_at > NOW()
     RETURNING id, shelter_id, email, role`,
    [hashInviteToken(token)]
  );
  return Array.isArray(rows) && rows.length ? rows[0] : null;
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
  normaliseShelterName(name);
  normaliseSlug(slug);
  const email = String(adminEmail || '').trim().toLowerCase();
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

  const passwordHash = await hashPassword(adminPassword);
  const { shelterId, name: shelterName, slug: shelterSlug } = await runWithoutShelter(
    () => createShelter(pool, { name, slug, logo, logoMime })
  );

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
  createShelter,
  createInvite,
  consumeInvite,
  hashInviteToken,
  createShelterWithAdmin,
  updateShelterBrand,
  LOGO_TYPES,
  MAX_LOGO_BYTES,
  INVITE_TOKEN_BYTES,
  INVITE_TTL_DAYS,
};
