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
  forEachShelter,
  bindShelter,
  requestCarriesShelterId,
  currentShelterId,
  isBypass,
  runWithShelter,
  runWithoutShelter,
};
