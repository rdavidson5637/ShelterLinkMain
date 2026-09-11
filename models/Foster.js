'use strict';

const { pool } = require('../config/database');

const URGENCIES = new Set(['planned', 'urgent']);
const REQUEST_STATUSES = new Set(['open', 'matched', 'cancelled']);
const OFFER_STATUSES = new Set(['pending', 'accepted', 'withdrawn', 'rejected']);
const PLACEMENT_STATUSES = new Set(['active', 'ended', 'returned_early']);
const SIZE_RANK = { small: 1, medium: 2, large: 3 };
const BOOL_REQUIREMENT_KEYS = new Set([
  'has_garden',
  'garden_secure',
  'has_other_dogs',
  'has_other_cats',
  'has_children_under_16',
  'can_medicate',
]);

function parseRequirements(raw) {
  if (raw == null || raw === '') return {};
  if (typeof raw === 'object' && !Array.isArray(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringifyRequirements(requirements) {
  if (requirements == null) return null;
  if (typeof requirements === 'string') {
    parseRequirements(requirements);
    return requirements;
  }
  return JSON.stringify(requirements);
}

function mapRequest(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    animal_id: Number(row.animal_id),
    created_by: Number(row.created_by),
    expected_duration_days:
      row.expected_duration_days == null ? null : Number(row.expected_duration_days),
    requirements: parseRequirements(row.requirements_json),
  };
}

function mapOffer(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    request_id: Number(row.request_id),
    user_id: Number(row.user_id),
  };
}

function mapPlacement(row) {
  if (!row) return null;
  return {
    ...row,
    id: Number(row.id),
    animal_id: Number(row.animal_id),
    user_id: Number(row.user_id),
    request_id: row.request_id == null ? null : Number(row.request_id),
  };
}

/**
 * Returns true when the volunteer is foster-approved and satisfies every
 * stated requirement on the request.
 */
function matchRequestToProfile(requirements, profile) {
  if (!profile || Number(profile.foster_approved) !== 1) {
    return false;
  }

  const reqs = parseRequirements(requirements);
  for (const [key, expected] of Object.entries(reqs)) {
    if (expected == null || expected === '') continue;

    if (key === 'home_type') {
      if (profile.home_type !== expected) return false;
      continue;
    }

    if (key === 'max_foster_size') {
      const needed = SIZE_RANK[expected];
      const have = SIZE_RANK[profile.max_foster_size];
      if (!needed || !have || have < needed) return false;
      continue;
    }

    if (BOOL_REQUIREMENT_KEYS.has(key)) {
      if (profile[key] == null || Number(profile[key]) !== Number(expected)) {
        return false;
      }
    }
  }

  return true;
}

async function findRequestById(id) {
  const [rows] = await pool.execute(
    `
      SELECT fr.*, a.name AS animal_name, a.species AS animal_species,
             a.status AS animal_status, a.handling_notes AS animal_handling_notes
      FROM foster_requests fr
      INNER JOIN animals a ON a.id = fr.animal_id
      WHERE fr.id = ?
      LIMIT 1
    `,
    [id]
  );
  return mapRequest(rows[0]);
}

async function createRequest({
  animalId,
  createdBy,
  urgency = 'planned',
  neededFrom,
  expectedDurationDays = null,
  requirements = null,
  description = null,
} = {}) {
  const animalIdNum = Number(animalId);
  if (!Number.isFinite(animalIdNum) || animalIdNum <= 0) {
    const err = new Error('animal_id is required');
    err.status = 400;
    throw err;
  }
  if (!createdBy) {
    const err = new Error('created_by is required');
    err.status = 400;
    throw err;
  }
  if (!neededFrom) {
    const err = new Error('needed_from is required');
    err.status = 400;
    throw err;
  }
  const [activePlacement] = await pool.execute(
    `SELECT id FROM foster_placements WHERE animal_id = ? AND status = 'active' LIMIT 1`,
    [animalIdNum]
  );
  if (activePlacement.length) {
    const err = new Error('This animal already has an active foster placement');
    err.status = 409;
    throw err;
  }

  const urg = URGENCIES.has(urgency) ? urgency : 'planned';
  const duration =
    expectedDurationDays == null || expectedDurationDays === ''
      ? null
      : Number(expectedDurationDays);
  if (duration != null && (!Number.isFinite(duration) || duration < 0)) {
    const err = new Error('expected_duration_days must be a non-negative number');
    err.status = 400;
    throw err;
  }

  const [result] = await pool.execute(
    `
      INSERT INTO foster_requests
        (animal_id, created_by, urgency, needed_from, expected_duration_days,
         requirements_json, description, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'open')
    `,
    [
      animalIdNum,
      createdBy,
      urg,
      neededFrom,
      duration,
      stringifyRequirements(requirements),
      description || null,
    ]
  );
  return findRequestById(result.insertId);
}

async function listRequests({ status = null } = {}) {
  const where = [];
  const params = [];
  if (status && REQUEST_STATUSES.has(status)) {
    where.push('fr.status = ?');
    params.push(status);
  }
  const [rows] = await pool.execute(
    `
      SELECT fr.*, a.name AS animal_name, a.species AS animal_species,
             a.status AS animal_status,
             (SELECT COUNT(*)::int FROM foster_offers fo
              WHERE fo.request_id = fr.id AND fo.status = 'pending') AS pending_offers
      FROM foster_requests fr
      INNER JOIN animals a ON a.id = fr.animal_id
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY
        CASE fr.urgency WHEN 'urgent' THEN 0 ELSE 1 END,
        fr.needed_from ASC,
        fr.id DESC
    `,
    params
  );
  return rows.map(mapRequest);
}

async function updateRequest(id, data = {}) {
  const assignments = [];
  const values = [];

  if (typeof data.urgency !== 'undefined') {
    if (!URGENCIES.has(data.urgency)) {
      const err = new Error('Invalid urgency');
      err.status = 400;
      throw err;
    }
    assignments.push('urgency = ?');
    values.push(data.urgency);
  }
  if (typeof data.needed_from !== 'undefined') {
    if (!data.needed_from) {
      const err = new Error('needed_from is required');
      err.status = 400;
      throw err;
    }
    assignments.push('needed_from = ?');
    values.push(data.needed_from);
  }
  if (typeof data.expected_duration_days !== 'undefined') {
    const duration =
      data.expected_duration_days == null || data.expected_duration_days === ''
        ? null
        : Number(data.expected_duration_days);
    if (duration != null && (!Number.isFinite(duration) || duration < 0)) {
      const err = new Error('expected_duration_days must be a non-negative number');
      err.status = 400;
      throw err;
    }
    assignments.push('expected_duration_days = ?');
    values.push(duration);
  }
  if (typeof data.requirements !== 'undefined' || typeof data.requirements_json !== 'undefined') {
    assignments.push('requirements_json = ?');
    values.push(
      stringifyRequirements(
        typeof data.requirements !== 'undefined' ? data.requirements : data.requirements_json
      )
    );
  }
  if (typeof data.description !== 'undefined') {
    assignments.push('description = ?');
    values.push(data.description || null);
  }
  if (typeof data.status !== 'undefined') {
    if (!REQUEST_STATUSES.has(data.status)) {
      const err = new Error('Invalid status');
      err.status = 400;
      throw err;
    }
    assignments.push('status = ?');
    values.push(data.status);
  }

  if (!assignments.length) {
    const err = new Error('No request fields provided for update');
    err.status = 400;
    throw err;
  }

  values.push(id);
  const [result] = await pool.execute(
    `UPDATE foster_requests SET ${assignments.join(', ')} WHERE id = ?`,
    values
  );
  if (!result.affectedRows) return null;
  return findRequestById(id);
}

async function cancelRequest(id) {
  return updateRequest(id, { status: 'cancelled' });
}

async function listOpenMatchingForUser(userId) {
  const VolunteerProfile = require('./VolunteerProfile');
  const profile = await VolunteerProfile.findByUserId(userId);
  if (!profile || Number(profile.foster_approved) !== 1) {
    return [];
  }

  const [rows] = await pool.execute(
    `
      SELECT fr.*, a.name AS animal_name, a.species AS animal_species,
             a.status AS animal_status,
             fo.id AS my_offer_id, fo.status AS my_offer_status
      FROM foster_requests fr
      INNER JOIN animals a ON a.id = fr.animal_id
      LEFT JOIN foster_offers fo
        ON fo.request_id = fr.id AND fo.user_id = ?
      WHERE fr.status = 'open'
      ORDER BY
        CASE fr.urgency WHEN 'urgent' THEN 0 ELSE 1 END,
        fr.needed_from ASC,
        fr.id DESC
    `,
    [userId]
  );

  return rows
    .map(mapRequest)
    .filter((req) => matchRequestToProfile(req.requirements_json || req.requirements, profile))
    .map((req) => {
      const { my_offer_id, my_offer_status, ...rest } = req;
      return {
        ...rest,
        my_offer:
          my_offer_id != null
            ? { id: Number(my_offer_id), status: my_offer_status }
            : null,
      };
    });
}

async function findOfferById(id) {
  const [rows] = await pool.execute(
    `
      SELECT fo.*, u.first_name, u.last_name, u.name, u.email,
             fr.animal_id, fr.status AS request_status, fr.needed_from,
             fr.expected_duration_days, a.name AS animal_name
      FROM foster_offers fo
      INNER JOIN foster_requests fr ON fr.id = fo.request_id
      INNER JOIN animals a ON a.id = fr.animal_id
      INNER JOIN users u ON u.user_id = fo.user_id
      WHERE fo.id = ?
      LIMIT 1
    `,
    [id]
  );
  return mapOffer(rows[0]);
}

async function listOffersForRequest(requestId) {
  const [rows] = await pool.execute(
    `
      SELECT fo.*, u.first_name, u.last_name, u.name, u.email, u.phone,
             vp.home_type, vp.has_garden, vp.garden_secure, vp.has_other_dogs,
             vp.has_other_cats, vp.has_children_under_16, vp.can_medicate,
             vp.max_foster_size, vp.foster_notes, vp.foster_approved
      FROM foster_offers fo
      INNER JOIN users u ON u.user_id = fo.user_id
      LEFT JOIN volunteer_profiles vp ON vp.user_id = fo.user_id
      WHERE fo.request_id = ?
      ORDER BY fo.created_at ASC, fo.id ASC
    `,
    [requestId]
  );
  return rows.map(mapOffer);
}

async function createOffer({ requestId, userId, note = null } = {}) {
  if (!requestId || !userId) {
    const err = new Error('request_id and user_id are required');
    err.status = 400;
    throw err;
  }

  const request = await findRequestById(requestId);
  if (!request) {
    const err = new Error('Foster request not found');
    err.status = 404;
    throw err;
  }
  if (request.status !== 'open') {
    const err = new Error('Foster request is not open');
    err.status = 400;
    throw err;
  }

  const VolunteerProfile = require('./VolunteerProfile');
  const profile = await VolunteerProfile.findByUserId(userId);
  if (!matchRequestToProfile(request.requirements_json || request.requirements, profile)) {
    const err = new Error('You do not match the requirements for this foster request');
    err.status = 403;
    throw err;
  }

  try {
    const [result] = await pool.execute(
      `
        INSERT INTO foster_offers (request_id, user_id, note, status)
        VALUES (?, ?, ?, 'pending')
      `,
      [requestId, userId, note || null]
    );
    return findOfferById(result.insertId);
  } catch (error) {
    if (error.code === '23505' || /unique|duplicate/i.test(error.message || '')) {
      const err = new Error('You have already offered on this request');
      err.status = 409;
      throw err;
    }
    throw error;
  }
}

/**
 * Atomically accept an offer: create placement, set animal to foster,
 * mark request matched, accept offer, reject sibling pending offers.
 */
async function confirmOffer(offerId, { startedOn = null, expectedEndOn = null, notes = null } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [offerRows] = await connection.execute(
      `
        SELECT fo.*, fr.animal_id, fr.status AS request_status,
               fr.needed_from, fr.expected_duration_days
        FROM foster_offers fo
        INNER JOIN foster_requests fr ON fr.id = fo.request_id
        WHERE fo.id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [offerId]
    );
    const offer = offerRows[0];
    if (!offer) {
      const err = new Error('Offer not found');
      err.status = 404;
      throw err;
    }
    if (offer.status !== 'pending') {
      const err = new Error('Offer is not pending');
      err.status = 400;
      throw err;
    }
    if (offer.request_status !== 'open') {
      const err = new Error('Foster request is not open');
      err.status = 400;
      throw err;
    }

    // Guard against double-placing the same animal: two separate open
    // requests for one animal (e.g. a stale request nobody cancelled) could
    // otherwise both be confirmed. Lock any existing active placement row so
    // two concurrent confirmOffer calls for the same animal can't both pass
    // this check before either commits.
    const [activeRows] = await connection.execute(
      `SELECT id FROM foster_placements WHERE animal_id = ? AND status = 'active' FOR UPDATE`,
      [offer.animal_id]
    );
    if (activeRows.length) {
      const err = new Error('This animal already has an active foster placement');
      err.status = 409;
      throw err;
    }

    const start =
      startedOn ||
      (offer.needed_from
        ? String(offer.needed_from).slice(0, 10)
        : new Date().toISOString().slice(0, 10));

    let endOn = expectedEndOn || null;
    if (!endOn && offer.expected_duration_days != null) {
      const startDate = new Date(`${start}T00:00:00Z`);
      startDate.setUTCDate(startDate.getUTCDate() + Number(offer.expected_duration_days));
      endOn = startDate.toISOString().slice(0, 10);
    }

    const [placementResult] = await connection.execute(
      `
        INSERT INTO foster_placements
          (animal_id, user_id, request_id, started_on, expected_end_on, status, notes)
        VALUES (?, ?, ?, ?, ?, 'active', ?)
      `,
      [offer.animal_id, offer.user_id, offer.request_id, start, endOn, notes || null]
    );

    await connection.execute(`UPDATE animals SET status = 'foster' WHERE id = ?`, [
      offer.animal_id,
    ]);
    await connection.execute(`UPDATE foster_requests SET status = 'matched' WHERE id = ?`, [
      offer.request_id,
    ]);
    await connection.execute(`UPDATE foster_offers SET status = 'accepted' WHERE id = ?`, [
      offerId,
    ]);
    await connection.execute(
      `
        UPDATE foster_offers
        SET status = 'rejected'
        WHERE request_id = ? AND id <> ? AND status = 'pending'
      `,
      [offer.request_id, offerId]
    );

    await connection.commit();

    const placement = await findPlacementById(placementResult.insertId);
    return {
      placement,
      offer: await findOfferById(offerId),
      request: await findRequestById(offer.request_id),
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    connection.release();
  }
}

async function findPlacementById(id) {
  const [rows] = await pool.execute(
    `
      SELECT fp.*, a.name AS animal_name, a.species AS animal_species,
             a.handling_notes AS animal_handling_notes, a.status AS animal_status,
             u.first_name, u.last_name, u.name, u.email, u.phone
      FROM foster_placements fp
      INNER JOIN animals a ON a.id = fp.animal_id
      INNER JOIN users u ON u.user_id = fp.user_id
      WHERE fp.id = ?
      LIMIT 1
    `,
    [id]
  );
  return mapPlacement(rows[0]);
}

async function listActivePlacements() {
  const [rows] = await pool.execute(
    `
      SELECT fp.*, a.name AS animal_name, a.species AS animal_species,
             a.handling_notes AS animal_handling_notes,
             u.first_name, u.last_name, u.name, u.email, u.phone
      FROM foster_placements fp
      INNER JOIN animals a ON a.id = fp.animal_id
      INNER JOIN users u ON u.user_id = fp.user_id
      WHERE fp.status = 'active'
      ORDER BY fp.started_on ASC, fp.id ASC
    `
  );
  return rows.map((row) => {
    const placement = mapPlacement(row);
    const start = placement.started_on ? new Date(`${String(placement.started_on).slice(0, 10)}T00:00:00Z`) : null;
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    placement.days_elapsed =
      start && !Number.isNaN(start.getTime())
        ? Math.max(0, Math.floor((today - start) / (24 * 60 * 60 * 1000)))
        : null;
    return placement;
  });
}

async function listPlacementsForUser(userId, { activeOnly = false } = {}) {
  const where = ['fp.user_id = ?'];
  const params = [userId];
  if (activeOnly) {
    where.push(`fp.status = 'active'`);
  }
  const [rows] = await pool.execute(
    `
      SELECT fp.*, a.name AS animal_name, a.species AS animal_species,
             a.handling_notes AS animal_handling_notes, a.status AS animal_status
      FROM foster_placements fp
      INNER JOIN animals a ON a.id = fp.animal_id
      WHERE ${where.join(' AND ')}
      ORDER BY
        CASE fp.status WHEN 'active' THEN 0 ELSE 1 END,
        fp.started_on DESC,
        fp.id DESC
    `,
    params
  );
  return rows.map(mapPlacement);
}

async function findActivePlacementForUserAnimal(userId, animalId) {
  const [rows] = await pool.execute(
    `
      SELECT fp.*
      FROM foster_placements fp
      WHERE fp.user_id = ? AND fp.animal_id = ? AND fp.status = 'active'
      LIMIT 1
    `,
    [userId, animalId]
  );
  return mapPlacement(rows[0]);
}

async function endPlacement(
  id,
  { endedOn = null, status = 'ended', notes = null, animalStatus = 'available' } = {}
) {
  const Animal = require('./Animal');
  if (!PLACEMENT_STATUSES.has(status) || status === 'active') {
    const err = new Error('status must be ended or returned_early');
    err.status = 400;
    throw err;
  }
  if (!Animal.STATUSES.has(animalStatus)) {
    const err = new Error('Invalid animal status');
    err.status = 400;
    throw err;
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [rows] = await connection.execute(
      `SELECT * FROM foster_placements WHERE id = ? LIMIT 1 FOR UPDATE`,
      [id]
    );
    const placement = rows[0];
    if (!placement) {
      const err = new Error('Placement not found');
      err.status = 404;
      throw err;
    }
    if (placement.status !== 'active') {
      const err = new Error('Placement is not active');
      err.status = 400;
      throw err;
    }

    const endDate = endedOn || new Date().toISOString().slice(0, 10);
    await connection.execute(
      `
        UPDATE foster_placements
        SET ended_on = ?, status = ?, notes = COALESCE(?, notes)
        WHERE id = ?
      `,
      [endDate, status, notes, id]
    );
    await connection.execute(`UPDATE animals SET status = ? WHERE id = ?`, [
      animalStatus,
      placement.animal_id,
    ]);

    await connection.commit();
    return findPlacementById(id);
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      /* ignore */
    }
    throw error;
  } finally {
    connection.release();
  }
}

module.exports = {
  URGENCIES,
  REQUEST_STATUSES,
  OFFER_STATUSES,
  PLACEMENT_STATUSES,
  parseRequirements,
  matchRequestToProfile,
  createRequest,
  findRequestById,
  listRequests,
  updateRequest,
  cancelRequest,
  listOpenMatchingForUser,
  createOffer,
  findOfferById,
  listOffersForRequest,
  confirmOffer,
  findPlacementById,
  listActivePlacements,
  listPlacementsForUser,
  findActivePlacementForUserAnimal,
  endPlacement,
};
