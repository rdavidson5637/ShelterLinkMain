'use strict';

const fs = require('fs');
const path = require('path');
const { pool } = require('../config/database');
const { findById } = require('../models/User');
const { isPlatformOwnerUser } = require('./platformOwner');
const { clearSessionCookie } = require('../utils/sessionCookie');
const {
  currentShelterId,
  isBypass,
  runWithShelter,
  runWithoutShelter,
} = require('../utils/shelterContext');
const Opportunity = require('../models/Opportunity');
const {
  filterPublicBoardOpportunities,
} = require('../utils/publicOpportunityFilter');
const { excludeTestOpportunities } = require('../utils/testOpportunityGuard');
const { pageMeta, injectSeoIntoHtml, publicOrigin } = require('../utils/seo');

let assisiId = null;
const htmlTemplateCache = new Map();

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

// Hits are cached for a short time so a suspension made on another server
// instance takes effect within CACHE_TTL_MS. The instance that suspends a
// shelter clears its own entries at once (forgetShelter).
const CACHE_TTL_MS = 30 * 1000;
const slugCache = new Map(); // slug -> { id, status, at }
const statusCache = new Map(); // shelter id -> { status, at }

function fresh(entry) {
  return entry && Date.now() - entry.at < CACHE_TTL_MS;
}

/** status is NOT NULL DEFAULT 'active'; a missing value means active. */
function isActiveStatus(status) {
  return status == null || status === 'active';
}

function cleanSlug(slug) {
  if (typeof slug !== 'string') return null;
  const key = slug.trim().toLowerCase();
  if (!key || key.length > SLUG_MAX || !SLUG_RE.test(key)) return null;
  return key;
}

/**
 * { id, status, name, slug } for a public slug, or null when no shelter
 * has it. A suspended shelter is returned with its status so callers can
 * tell "suspended" from "unknown".
 *
 * Only hits are cached. A miss is not, so a shelter added later is found
 * without a restart, and unknown slugs from URLs cannot grow the cache.
 */
async function shelterFromSlug(slug) {
  const key = cleanSlug(slug);
  if (!key) return null;
  const cached = slugCache.get(key);
  if (fresh(cached)) {
    return {
      id: cached.id,
      status: cached.status,
      name: cached.name || null,
      slug: key,
    };
  }

  const [rows] = await runWithoutShelter(() => pool.execute(
    'SELECT id, status, name FROM shelters WHERE slug = ? LIMIT 1',
    [key]
  ));
  const row = rows[0];
  const id = Number(row && row.id);
  if (!Number.isInteger(id) || id <= 0) {
    slugCache.delete(key);
    return null;
  }
  const status = row.status == null ? 'active' : String(row.status);
  const name = row.name == null ? null : String(row.name);
  slugCache.set(key, { id, status, name, at: Date.now() });
  statusCache.set(id, { status, at: Date.now() });
  return { id, status, name, slug: key };
}

/**
 * Shelter id for a public slug, or null. Only an active shelter has one:
 * a suspended shelter's slug answers null, the same as an unknown slug,
 * so /join/<slug> and volunteer sign-up refuse it.
 */
async function shelterIdFromSlug(slug) {
  const shelter = await shelterFromSlug(slug);
  return shelter && isActiveStatus(shelter.status) ? shelter.id : null;
}

/** 'active', 'suspended', or null when the shelter row is missing. */
async function shelterStatus(shelterId) {
  const id = Number(shelterId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const cached = statusCache.get(id);
  if (fresh(cached)) return cached.status;
  const [rows] = await runWithoutShelter(() => pool.execute(
    'SELECT status FROM shelters WHERE id = ? LIMIT 1',
    [id]
  ));
  if (!rows[0]) {
    statusCache.delete(id);
    return null;
  }
  const status = rows[0].status == null ? 'active' : String(rows[0].status);
  statusCache.set(id, { status, at: Date.now() });
  return status;
}

/** Drop cached slug and status entries after a shelter's status changes. */
function forgetShelter({ id, slug } = {}) {
  const key = cleanSlug(slug);
  if (key) slugCache.delete(key);
  const numericId = Number(id);
  if (Number.isInteger(numericId) && numericId > 0) {
    statusCache.delete(numericId);
    for (const [cachedSlug, entry] of slugCache) {
      if (entry.id === numericId) slugCache.delete(cachedSlug);
    }
  }
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
 * Shelter for a public read or form. A slug, when given, decides: it must
 * name an active shelter, or the answer is null (callers send 404). Only a
 * request with no slug at all keeps the old fallback: the session's
 * shelter, then Assisi.
 *
 * An unknown or suspended slug must never fall back to another shelter: an
 * ICS subscriber, an embedded board or a typo'd /s/<slug> link would quietly
 * start showing (or booking) someone else's shifts.
 */
async function publicShelterId(req) {
  const slug = requestedShelterSlug(req);
  if (slug) {
    const shelter = await shelterFromSlug(slug);
    return shelter && isActiveStatus(shelter.status) ? shelter.id : null;
  }
  return currentShelterId() || assisiShelterId();
}

function _resetSlugCacheForTests() {
  slugCache.clear();
  statusCache.clear();
}

/**
 * Run fn once per shelter, inside that shelter. Suspended shelters are
 * skipped by default, so jobs stop emailing and pushing to their people.
 * Pass { includeSuspended: true } for housekeeping that must keep running,
 * such as data retention and expired-token cleanup.
 */
async function forEachShelter(fn, { includeSuspended = false } = {}) {
  const [rows] = await runWithoutShelter(() => pool.execute(
    includeSuspended
      ? 'SELECT id FROM shelters ORDER BY id'
      : "SELECT id FROM shelters WHERE status = 'active' ORDER BY id"
  ));
  const results = [];
  for (const row of rows) {
    results.push(await runWithShelter(row.id, () => fn(row.id)));
  }
  return results;
}

function readHtmlTemplate(file) {
  const key = path.resolve(file);
  if (htmlTemplateCache.has(key)) return htmlTemplateCache.get(key);
  const html = fs.readFileSync(key, 'utf8');
  htmlTemplateCache.set(key, html);
  return html;
}

/**
 * Charity / contact fields for JSON-LD. Only columns that exist on shelters;
 * never invents a town, phone, or postal address.
 */
async function loadShelterSeoFields(shelterId) {
  const id = Number(shelterId);
  if (!Number.isInteger(id) || id <= 0) return null;
  const [rows] = await runWithoutShelter(() =>
    pool.execute(
      `SELECT charity_number, charity_register_name, privacy_contact_email
         FROM shelters
        WHERE id = ?
        LIMIT 1`,
      [id]
    )
  );
  const row = rows[0];
  if (!row) return null;
  return {
    charityNumber: row.charity_number == null ? null : String(row.charity_number),
    charityRegisterName:
      row.charity_register_name == null ? null : String(row.charity_register_name),
    email:
      row.privacy_contact_email == null
        ? null
        : String(row.privacy_contact_email).trim() || null,
  };
}

function publicBoardStartFloor() {
  return new Date(Date.now() - 12 * 60 * 60 * 1000);
}

function toSqlTimestamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

/**
 * Upcoming open shifts for JSON-LD on the open-shifts page. Same public
 * window and title filter as the board API; closures are not re-checked here
 * (avoids a middleware ↔ closureController cycle). Only real opportunity rows.
 */
async function loadSeoOpportunities(shelterId) {
  const id = Number(shelterId);
  if (!Number.isInteger(id) || id <= 0) return [];
  const floor = publicBoardStartFloor();
  const sqlFloor = new Date(floor.getTime() - 24 * 60 * 60 * 1000);
  const raw = await runWithShelter(id, () =>
    Opportunity.findAll({
      status: 'open',
      start_date_from: toSqlTimestamp(sqlFloor),
    })
  );
  const visible = filterPublicBoardOpportunities(excludeTestOpportunities(raw));
  return visible.filter((opp) => {
    const start = new Date(opp.start_date);
    return !Number.isNaN(start.getTime()) && start.getTime() >= floor.getTime();
  });
}

/**
 * Page handler for /join/<slug> and /s/<slug>/...: sends the file only when
 * the slug names an active shelter. An unknown or suspended shelter falls
 * through to the normal 404 page, so a visitor never gets a form or board
 * that would quietly show or sign up to a different shelter.
 *
 * When pageKey is set (home, opportunities, group-booking), injects title,
 * meta description, Open Graph tags, and Organization/NGO + VolunteerAction
 * JSON-LD for that approved shelter before sending HTML. The open-shifts
 * page also embeds VolunteerAction nodes for each upcoming open shift.
 */
function activeShelterPage(file, pageKey = null) {
  return async function sendActiveShelterPage(req, res, next) {
    try {
      const shelter = await shelterFromSlug(req.params.slug);
      if (!shelter || !isActiveStatus(shelter.status)) return next();
      if (!pageKey) {
        return res.sendFile(file);
      }
      const seoFields = (await loadShelterSeoFields(shelter.id)) || {};
      const meta = {
        ...pageMeta({
          pageKey,
          shelterName: shelter.name || 'your local shelter',
          slug: shelter.slug || cleanSlug(req.params.slug),
          origin: publicOrigin(),
        }),
        email: seoFields.email || null,
        charityNumber: seoFields.charityNumber || null,
        charityRegisterName: seoFields.charityRegisterName || null,
      };
      // Opportunity nodes only on the open-shifts page (and home as a light
      // preview would invent nothing, but the board is the source of truth).
      const opportunities =
        pageKey === 'opportunities' ? await loadSeoOpportunities(shelter.id) : [];
      const html = injectSeoIntoHtml(readHtmlTemplate(file), meta, opportunities);
      res.setHeader('Content-Type', 'text/html; charset=utf-8');
      res.setHeader('Cache-Control', 'public, max-age=60');
      return res.status(200).send(html);
    } catch (error) {
      return next(error);
    }
  };
}

function _clearHtmlTemplateCacheForTests() {
  htmlTemplateCache.clear();
}

// Paths (under the /api mount) a platform owner may still use while their
// own shelter is suspended: the platform console and their own sign-in state.
const PLATFORM_OWNER_SUSPENDED_PATHS = /^\/(platform(\/|$)|auth\/(me|logout)$)/;

const SUSPENDED_MESSAGE = 'This shelter is not active on ShelterLink at the moment. Contact the shelter for more information.';

function endSuspendedSession(req, res) {
  const body = { error: SUSPENDED_MESSAGE, code: 'shelter_suspended' };
  const respond = () => {
    clearSessionCookie(res);
    return res.status(403).json(body);
  };
  if (req.session && typeof req.session.destroy === 'function') {
    return req.session.destroy(() => respond());
  }
  return respond();
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

    // A suspended shelter's people are signed out on their next request.
    // Nothing is deleted; the session simply ends. A platform owner whose
    // own shelter is suspended keeps the session and /api/platform (so they
    // can reactivate it), but the shelter's own API answers 403.
    if (!isActiveStatus(await shelterStatus(user.shelter_id))) {
      if (await isPlatformOwnerUser(req.session.userId)) {
        if (!PLATFORM_OWNER_SUSPENDED_PATHS.test(req.path || '')) {
          return res.status(403).json({ error: SUSPENDED_MESSAGE, code: 'shelter_suspended' });
        }
      } else {
        return endSuspendedSession(req, res);
      }
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
  shelterFromSlug,
  shelterStatus,
  isActiveStatus,
  forgetShelter,
  activeShelterPage,
  SUSPENDED_MESSAGE,
  requestedShelterSlug,
  publicShelterId,
  _resetSlugCacheForTests,
  _clearHtmlTemplateCacheForTests,
  forEachShelter,
  bindShelter,
  requestCarriesShelterId,
  currentShelterId,
  isBypass,
  runWithShelter,
  runWithoutShelter,
};
