'use strict';

const { pool } = require('../config/database');
const { findById } = require('../models/User');
const {
  currentShelterId,
  isBypass,
  runWithShelter,
  runWithoutShelter,
} = require('../utils/shelterContext');

let assisiId = null;

function requestCarriesShelterId(req) {
  const stacks = [req.body, req.query, req.params];
  const visit = (value) => {
    if (!value || typeof value !== 'object') return false;
    if (Array.isArray(value)) return value.some(visit);
    for (const [key, nested] of Object.entries(value)) {
      if (key === 'shelter_id' || key === 'shelterId') return true;
      if (visit(nested)) return true;
    }
    return false;
  };
  return stacks.some(visit);
}

async function assisiShelterId() {
  if (assisiId) return assisiId;
  const [rows] = await runWithoutShelter(() => pool.execute(
    `SELECT id FROM shelters WHERE slug = 'assisi' LIMIT 1`
  ));
  const id = Number(rows[0] && rows[0].id);
  if (!Number.isInteger(id) || id <= 0) return null;
  assisiId = id;
  return assisiId;
}

// Matches shelters_slug_lowercase_chk and the VARCHAR(100) column.
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX = 100;
const slugCache = new Map();

/**
 * Shelter id for a public slug, or null.
 *
 * "Active" means the row exists. shelters has no status column yet; the
 * approval gate is a later change and should add its filter to this query.
 *
 * Only hits are cached. A miss is not, so a shelter added later is found
 * without a restart, and unknown slugs from URLs cannot grow the cache.
 */
async function shelterIdFromSlug(slug) {
  if (typeof slug !== 'string') return null;
  const key = slug.trim().toLowerCase();
  if (!key || key.length > SLUG_MAX || !SLUG_RE.test(key)) return null;
  if (slugCache.has(key)) return slugCache.get(key);

  const [rows] = await runWithoutShelter(() => pool.execute(
    'SELECT id FROM shelters WHERE slug = ? LIMIT 1',
    [key]
  ));
  const id = Number(rows[0] && rows[0].id);
  if (!Number.isInteger(id) || id <= 0) return null;
  slugCache.set(key, id);
  return id;
}

/**
 * Slug a public request names, or null. A route :slug param wins, then
 * ?shelter=, then a shelter_slug body field. Only a slug is ever read here,
 * never a shelter id. Arrays (?shelter=a&shelter=b) are ignored.
 */
function requestedShelterSlug(req) {
  const candidates = [
    req && req.params && req.params.slug,
    req && req.query && req.query.shelter,
    req && req.body && req.body.shelter_slug,
  ];
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value;
  }
  return null;
}

/**
 * Shelter for a public read or form. A known slug wins over the session, so
 * a page for slug B only ever reads or writes shelter B. With no slug, or a
 * slug that matches no shelter, this keeps the old fallback: the session's
 * shelter, then Assisi.
 */
async function publicShelterId(req) {
  const slug = requestedShelterSlug(req);
  if (slug) {
    const id = await shelterIdFromSlug(slug);
    if (id) return id;
  }
  return currentShelterId() || assisiShelterId();
}

function _resetSlugCacheForTests() {
  slugCache.clear();
}

async function forEachShelter(fn) {
  const [rows] = await runWithoutShelter(() => pool.execute(
    'SELECT id FROM shelters ORDER BY id'
  ));
  const results = [];
  for (const row of rows) {
    results.push(await runWithShelter(row.id, () => fn(row.id)));
  }
  return results;
}

/**
 * Shelter id comes from the user row for the session. It is never read from
 * the body, query string, or route params.
 */
async function bindShelter(req, res, next) {
  try {
    if (requestCarriesShelterId(req)) {
      return res.status(400).json({ error: 'shelter_id is not accepted' });
    }
    if (!req.session || !req.session.userId) return next();

    const user = await runWithoutShelter(() => findById(req.session.userId));
    if (!user || !user.shelter_id) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    req.session.shelterId = user.shelter_id;
    req.user = { ...user, role: user.role || req.session.role };
    if (user.role) req.session.role = user.role;
    return runWithShelter(user.shelter_id, () => next());
  } catch (error) {
    return next(error);
  }
}

module.exports = {
  assisiShelterId,
  shelterIdFromSlug,
  requestedShelterSlug,
  publicShelterId,
  _resetSlugCacheForTests,
  forEachShelter,
  bindShelter,
  requestCarriesShelterId,
  currentShelterId,
  isBypass,
  runWithShelter,
  runWithoutShelter,
};
