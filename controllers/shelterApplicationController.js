'use strict';

/**
 * Public shelter application (PR8): POST /api/public/shelter-applications.
 *
 * A charity asks to join ShelterLink. This only writes a pending row to the
 * global shelter_applications table; nothing goes live until a platform
 * owner approves it at /platform/shelters. No email is sent from here.
 *
 * Launch regulators only (Northern Ireland and England and Wales). The
 * charity register answer is saved as evidence for the platform owner. It
 * never approves anything by itself, and an unavailable register does not
 * block the application.
 */

const { pool } = require('../config/database');
const { runWithoutShelter } = require('../utils/shelterContext');
const { lookupCharity, validateCharityNumber, LIVE_REGULATORS } = require('../services/charityRegister');

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_MIN = 3;
const SLUG_MAX = 60;
const LOOKUP_TIMEOUT_MS = 8000;

// A person takes more than a few seconds to fill this in; a script does not.
// started_at is set by the page when it loads.
const MIN_FILL_MS = 3000;
const MAX_FORM_AGE_MS = 12 * 60 * 60 * 1000;

function positiveInt(name, fallback) {
  const value = Number(process.env[name]);
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

// The queue is read by a person. Past these, new applications are turned
// away until the owner catches up, so a flood cannot bury real ones.
function pendingCaps() {
  return {
    total: positiveInt('SHELTER_APPLY_MAX_PENDING', 100),
    perEmail: positiveInt('SHELTER_APPLY_MAX_PENDING_PER_EMAIL', 3),
  };
}

const QUEUE_FULL = 'We are not taking new applications just now. Please try again in a few days.';
const EMAIL_FULL = 'You already have applications waiting for review. We will be in touch about those first.';

// Paths and names a shelter must not take: they collide with app routes or
// would look official.
const RESERVED_SLUGS = new Set([
  'admin', 'api', 'apply', 'app', 'assets', 'demo', 'healthz', 'help', 'invite', 'join',
  'login', 'logout', 'pages', 'platform', 'privacy', 'public', 'register', 's', 'settings',
  'shelterlink', 'staff', 'support', 'test', 'www',
]);

const RECEIVED = 'Thanks. Your application is with us. When it is approved, we will email a link to set up your account.';

function fieldError(field, message, status = 400) {
  const error = new Error(message);
  error.status = status;
  error.field = field;
  return error;
}

function cleanText(value, { field, label, min, max }) {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (text.length < min) throw fieldError(field, `Enter ${label}.`);
  if (text.length > max) throw fieldError(field, `${label[0].toUpperCase()}${label.slice(1)} must be ${max} characters or fewer.`);
  return text;
}

function cleanSlug(value) {
  const slug = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!slug) throw fieldError('desired_slug', 'Choose a web address for your shelter.');
  if (slug.length < SLUG_MIN || slug.length > SLUG_MAX || !SLUG_RE.test(slug)) {
    throw fieldError(
      'desired_slug',
      `Use ${SLUG_MIN} to ${SLUG_MAX} lowercase letters and numbers, with single hyphens between words, for example north-paws.`
    );
  }
  if (RESERVED_SLUGS.has(slug)) throw fieldError('desired_slug', 'That web address is reserved. Choose another.');
  return slug;
}

/** The submission, checked and normalised. Throws a field error. */
function readApplication(body = {}) {
  const shelterName = cleanText(body.shelter_name, {
    field: 'shelter_name', label: 'your shelter\'s name', min: 2, max: 255,
  });
  const desiredSlug = cleanSlug(body.desired_slug);

  const regulator = typeof body.regulator === 'string' ? body.regulator.trim().toLowerCase() : '';
  if (!LIVE_REGULATORS.includes(regulator)) {
    throw fieldError(
      'regulator',
      'ShelterLink is open to charities registered in Northern Ireland or in England and Wales for now.'
    );
  }
  const number = validateCharityNumber(regulator, body.charity_number);
  if (!number.ok) throw fieldError('charity_number', number.error);

  const contactName = cleanText(body.contact_name, {
    field: 'contact_name', label: 'your name', min: 2, max: 200,
  });
  const contactEmail = typeof body.contact_email === 'string' ? body.contact_email.trim().toLowerCase() : '';
  if (!EMAIL_RE.test(contactEmail) || contactEmail.length > 255) {
    throw fieldError('contact_email', 'Enter an email address like name@example.org.');
  }

  return {
    shelterName,
    desiredSlug,
    regulator,
    charityNumber: number.value,
    contactName,
    contactEmail,
  };
}

/** Register answer for the platform owner. Never throws, never hangs. */
async function registerSnapshot(regulator, charityNumber, lookup = lookupCharity, timeoutMs = LOOKUP_TIMEOUT_MS) {
  let timer;
  try {
    const timeout = new Promise((resolve) => {
      timer = setTimeout(() => resolve({ found: false, status: 'unavailable', message: 'Register lookup timed out' }), timeoutMs);
    });
    const result = await Promise.race([lookup(regulator, charityNumber), timeout]);
    return result || { found: false, status: 'unavailable' };
  } catch (error) {
    console.error('[ShelterApply] register lookup failed:', error && error.message);
    return { found: false, status: 'unavailable', message: 'Register lookup failed' };
  } finally {
    clearTimeout(timer);
  }
}

/** null when the form was open long enough, else the message to show. */
function fillTimeError(body, now = Date.now()) {
  const started = Number(body && body.started_at);
  if (!Number.isFinite(started) || started <= 0) return 'Reload the page and try again.';
  const elapsed = now - started;
  if (elapsed < MIN_FILL_MS) return 'Please take a moment to check your details, then send again.';
  if (elapsed > MAX_FORM_AGE_MS) return 'This form has expired. Reload the page and try again.';
  return null;
}

async function assertQueueHasRoom(app) {
  const caps = pendingCaps();
  const [rows] = await pool.execute(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE lower(contact_email) = lower(?))::int AS mine
     FROM shelter_applications WHERE status = 'pending'`,
    [app.contactEmail]
  );
  const row = rows[0] || {};
  if (Number(row.mine) >= caps.perEmail) throw fieldError(null, EMAIL_FULL, 429);
  if (Number(row.total) >= caps.total) throw fieldError(null, QUEUE_FULL, 503);
}

// Unique indexes from 040_shelter_applications_pending_unique.pg.sql. Two
// submissions racing past assertAvailable land here.
const PENDING_UNIQUE = {
  shelter_applications_pending_slug_key: () => fieldError('desired_slug', 'That web address is already taken. Choose another.', 409),
  shelter_applications_pending_charity_key: () => fieldError('charity_number', 'An application for this charity is already waiting for review.', 409),
};

async function assertAvailable(app) {
  const [slugShelter] = await pool.execute('SELECT id FROM shelters WHERE slug = ? LIMIT 1', [app.desiredSlug]);
  const [slugPending] = await pool.execute(
    `SELECT id FROM shelter_applications WHERE desired_slug = ? AND status = 'pending' LIMIT 1`,
    [app.desiredSlug]
  );
  if (slugShelter.length || slugPending.length) {
    throw fieldError('desired_slug', 'That web address is already taken. Choose another.', 409);
  }

  const [charityShelter] = await pool.execute(
    'SELECT id FROM shelters WHERE charity_regulator = ? AND charity_number = ? LIMIT 1',
    [app.regulator, app.charityNumber]
  );
  if (charityShelter.length) {
    throw fieldError('charity_number', 'This charity already has a shelter on ShelterLink.', 409);
  }
  const [charityPending] = await pool.execute(
    `SELECT id FROM shelter_applications
     WHERE regulator = ? AND charity_number = ? AND status = 'pending' LIMIT 1`,
    [app.regulator, app.charityNumber]
  );
  if (charityPending.length) {
    throw fieldError('charity_number', 'An application for this charity is already waiting for review.', 409);
  }
}

async function submitShelterApplication(req, res) {
  const body = req.body || {};
  // Honeypot: a field people never see. Bots that fill it get the normal
  // answer and nothing is stored.
  if (typeof body.website === 'string' && body.website.trim()) {
    return res.status(201).json({ message: RECEIVED });
  }

  try {
    const tooFast = fillTimeError(body);
    if (tooFast) throw fieldError(null, tooFast);
    const app = readApplication(body);
    await runWithoutShelter(async () => {
      await assertQueueHasRoom(app);
      await assertAvailable(app);
      const snapshot = await registerSnapshot(app.regulator, app.charityNumber);
      try {
        await pool.execute(
          `INSERT INTO shelter_applications
             (shelter_name, desired_slug, regulator, charity_number, register_snapshot, contact_name, contact_email)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [
            app.shelterName,
            app.desiredSlug,
            app.regulator,
            app.charityNumber,
            JSON.stringify(snapshot),
            app.contactName,
            app.contactEmail,
          ]
        );
      } catch (error) {
        if (error && error.code === '23514') throw fieldError('desired_slug', 'That web address is not allowed. Choose another.');
        if (error && error.code === '23505' && PENDING_UNIQUE[error.constraint]) throw PENDING_UNIQUE[error.constraint]();
        throw error;
      }
    });
    return res.status(201).json({ message: RECEIVED });
  } catch (error) {
    if (error && Number.isInteger(error.status) && (error.status < 500 || error.status === 503)) {
      return res.status(error.status).json({ error: error.message, field: error.field || null });
    }
    console.error('[ShelterApply] submit error:', error && error.message);
    return res.status(500).json({ error: 'Internal server error' });
  }
}

module.exports = {
  submitShelterApplication,
  readApplication,
  registerSnapshot,
  fillTimeError,
  MIN_FILL_MS,
  RESERVED_SLUGS,
  RECEIVED,
};
