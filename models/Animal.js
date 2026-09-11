'use strict';

const { pool } = require('../config/database');

const SPECIES = new Set(['dog', 'cat', 'small_animal', 'other']);
const STATUSES = new Set([
  'available',
  'reserved',
  'adopted',
  'foster',
  'medical',
  'not_for_rehoming',
]);
const ACTIVITY_TYPES = new Set([
  'walk',
  'feed',
  'socialise',
  'clean',
  'medical',
  'transport',
  'other',
]);

const ALLOWED_UPDATE = new Set([
  'name',
  'species',
  'breed',
  'sex',
  'date_of_birth',
  'arrival_date',
  'status',
  'kennel_ref',
  'photo_filename',
  'notes',
  'handling_notes',
  'requires_qualification_id',
]);

function mapRow(row) {
  if (!row) return null;
  row.id = Number(row.id);
  if (row.requires_qualification_id != null) {
    row.requires_qualification_id = Number(row.requires_qualification_id);
  }
  return row;
}

function normalizeAnimalIds(raw) {
  if (raw == null) return null;
  if (!Array.isArray(raw)) return [];
  return [
    ...new Set(
      raw
        .map((id) =>
          typeof id === 'object' && id != null
            ? Number(id.id ?? id.animal_id)
            : Number(id)
        )
        .filter((id) => Number.isFinite(id) && id > 0)
    ),
  ];
}

async function create(data = {}) {
  const name = String(data.name || '').trim();
  if (!name) {
    const err = new Error('name is required');
    err.status = 400;
    throw err;
  }
  const species = SPECIES.has(data.species) ? data.species : 'dog';
  const status = STATUSES.has(data.status) ? data.status : 'available';
  const requiresQualificationId =
    data.requires_qualification_id != null && data.requires_qualification_id !== ''
      ? Number(data.requires_qualification_id)
      : null;

  const sql = `
    INSERT INTO animals
      (name, species, breed, sex, date_of_birth, arrival_date, status,
       kennel_ref, photo_filename, notes, handling_notes, requires_qualification_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `;
  const [result] = await pool.execute(sql, [
    name,
    species,
    data.breed || null,
    data.sex || null,
    data.date_of_birth || null,
    data.arrival_date || null,
    status,
    data.kennel_ref || null,
    data.photo_filename || null,
    data.notes || null,
    data.handling_notes || null,
    Number.isFinite(requiresQualificationId) && requiresQualificationId > 0
      ? requiresQualificationId
      : null,
  ]);
  return findById(result.insertId);
}

async function findById(id) {
  const [rows] = await pool.execute(
    `
      SELECT a.*, q.name AS requires_qualification_name
      FROM animals a
      LEFT JOIN qualifications q ON q.id = a.requires_qualification_id
      WHERE a.id = ?
      LIMIT 1
    `,
    [id]
  );
  return mapRow(rows[0]);
}

async function findAll({ species = null, status = null } = {}) {
  const where = [];
  const params = [];
  if (species && SPECIES.has(species)) {
    where.push('a.species = ?');
    params.push(species);
  }
  if (status && STATUSES.has(status)) {
    where.push('a.status = ?');
    params.push(status);
  }
  const sql = `
    SELECT a.*, q.name AS requires_qualification_name
    FROM animals a
    LEFT JOIN qualifications q ON q.id = a.requires_qualification_id
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
    ORDER BY a.name ASC, a.id ASC
  `;
  const [rows] = await pool.execute(sql, params);
  return rows.map(mapRow);
}

async function update(id, data = {}) {
  const entries = Object.entries(data).filter(
    ([key, value]) => ALLOWED_UPDATE.has(key) && typeof value !== 'undefined'
  );
  if (!entries.length) {
    const err = new Error('No animal fields provided for update');
    err.status = 400;
    throw err;
  }

  const values = [];
  const assignments = entries.map(([key, value]) => {
    if (key === 'species' && !SPECIES.has(value)) {
      const err = new Error('Invalid species');
      err.status = 400;
      throw err;
    }
    if (key === 'status' && !STATUSES.has(value)) {
      const err = new Error('Invalid status');
      err.status = 400;
      throw err;
    }
    if (key === 'requires_qualification_id') {
      const n = value == null || value === '' ? null : Number(value);
      values.push(Number.isFinite(n) && n > 0 ? n : null);
      return 'requires_qualification_id = ?';
    }
    if (key === 'name') {
      const name = String(value || '').trim();
      if (!name) {
        const err = new Error('name is required');
        err.status = 400;
        throw err;
      }
      values.push(name);
      return 'name = ?';
    }
    values.push(value == null || value === '' ? null : value);
    return `${key} = ?`;
  });

  values.push(id);
  const [result] = await pool.execute(
    `UPDATE animals SET ${assignments.join(', ')} WHERE id = ?`,
    values
  );
  if (!result.affectedRows) return null;
  return findById(id);
}

/**
 * Upsert an animal's photo bytes. Stored in `animal_photos` (not on `animals`)
 * so listing animals never loads image data. `content` is a Buffer.
 */
async function setPhoto(animalId, { content, mimeType }) {
  if (!Buffer.isBuffer(content) || content.length === 0) {
    const err = new Error('Photo content is required');
    err.status = 400;
    throw err;
  }
  await pool.execute(
    `INSERT INTO animal_photos (animal_id, content, mime_type, updated_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT (animal_id)
     DO UPDATE SET content = EXCLUDED.content,
                   mime_type = EXCLUDED.mime_type,
                   updated_at = CURRENT_TIMESTAMP`,
    [animalId, content, mimeType || 'image/jpeg']
  );
}

/** Fetch an animal's photo bytes for serving, or null when there is none. */
async function getPhoto(animalId) {
  const [rows] = await pool.execute(
    `SELECT content, mime_type FROM animal_photos WHERE animal_id = ? LIMIT 1`,
    [animalId]
  );
  const row = rows[0];
  if (!row || !row.content) return null;
  return {
    buffer: Buffer.isBuffer(row.content) ? row.content : Buffer.from(row.content),
    mimeType: row.mime_type || 'image/jpeg',
  };
}

async function setStatus(id, status) {
  if (!STATUSES.has(status)) {
    const err = new Error('Invalid status');
    err.status = 400;
    throw err;
  }
  return update(id, { status });
}

async function findForOpportunity(opportunityId) {
  const [rows] = await pool.execute(
    `
      SELECT a.*, q.name AS requires_qualification_name
      FROM opportunity_animals oa
      INNER JOIN animals a ON a.id = oa.animal_id
      LEFT JOIN qualifications q ON q.id = a.requires_qualification_id
      WHERE oa.opportunity_id = ?
      ORDER BY a.name ASC
    `,
    [opportunityId]
  );
  return rows.map(mapRow);
}

async function setOpportunityAnimals(opportunityId, animalIds = []) {
  const ids = normalizeAnimalIds(animalIds) || [];
  await pool.execute(`DELETE FROM opportunity_animals WHERE opportunity_id = ?`, [
    opportunityId,
  ]);
  for (const animalId of ids) {
    await pool.execute(
      `INSERT INTO opportunity_animals (opportunity_id, animal_id) VALUES (?, ?)
       ON CONFLICT (opportunity_id, animal_id) DO NOTHING`,
      [opportunityId, animalId]
    );
  }
  return findForOpportunity(opportunityId);
}

async function attachAnimals(opportunityOrList) {
  if (!opportunityOrList) return opportunityOrList;
  const list = Array.isArray(opportunityOrList) ? opportunityOrList : [opportunityOrList];
  if (!list.length) return opportunityOrList;

  const ids = list
    .map((o) => Number(o.opportunity_id || o.id))
    .filter((id) => Number.isFinite(id) && id > 0);
  if (!ids.length) {
    list.forEach((o) => {
      o.animals = [];
    });
    return Array.isArray(opportunityOrList) ? list : list[0];
  }

  const placeholders = ids.map(() => '?').join(', ');
  const [rows] = await pool.execute(
    `
      SELECT oa.opportunity_id, a.*, q.name AS requires_qualification_name
      FROM opportunity_animals oa
      INNER JOIN animals a ON a.id = oa.animal_id
      LEFT JOIN qualifications q ON q.id = a.requires_qualification_id
      WHERE oa.opportunity_id IN (${placeholders})
      ORDER BY a.name ASC
    `,
    ids
  );

  const byOpp = new Map();
  for (const row of rows) {
    const oppId = Number(row.opportunity_id);
    if (!byOpp.has(oppId)) byOpp.set(oppId, []);
    const animal = mapRow({ ...row });
    delete animal.opportunity_id;
    byOpp.get(oppId).push(animal);
  }

  for (const opp of list) {
    const oppId = Number(opp.opportunity_id || opp.id);
    opp.animals = byOpp.get(oppId) || [];
  }
  return Array.isArray(opportunityOrList) ? list : list[0];
}

/**
 * Animals on a shift that require a qualification the volunteer is missing/expired.
 */
async function findMissingQualificationsForUser(userId, opportunityId, asOf = new Date()) {
  const animals = await findForOpportunity(opportunityId);
  const gated = animals.filter((a) => a.requires_qualification_id);
  if (!gated.length) return [];

  const Qualification = require('./Qualification');
  const held = await Qualification.findByUserId(userId);
  const heldById = new Map(held.map((h) => [Number(h.qualification_id), h]));
  const today = String(asOf.toISOString().slice(0, 10));

  const missing = [];
  for (const animal of gated) {
    const qid = Number(animal.requires_qualification_id);
    const award = heldById.get(qid);
    const expired =
      award &&
      award.expires_at &&
      String(award.expires_at).slice(0, 10) < today;
    if (!award || expired) {
      missing.push({
        animal_id: animal.id,
        animal_name: animal.name,
        qualification_id: qid,
        qualification_name: animal.requires_qualification_name || 'Required qualification',
        reason: !award ? 'missing' : 'expired',
      });
    }
  }
  return missing;
}

async function logActivity({
  animalId,
  userId,
  applicationId = null,
  activityType,
  notes = null,
}) {
  if (!ACTIVITY_TYPES.has(activityType)) {
    const err = new Error('Invalid activity_type');
    err.status = 400;
    throw err;
  }
  const [result] = await pool.execute(
    `
      INSERT INTO animal_activity
        (animal_id, user_id, application_id, activity_type, notes)
      VALUES (?, ?, ?, ?, ?)
    `,
    [animalId, userId, applicationId || null, activityType, notes || null]
  );
  return findActivityById(result.insertId);
}

async function findActivityById(id) {
  const [rows] = await pool.execute(
    `
      SELECT aa.*, a.name AS animal_name, u.first_name, u.last_name, u.name
      FROM animal_activity aa
      INNER JOIN animals a ON a.id = aa.animal_id
      INNER JOIN users u ON u.user_id = aa.user_id
      WHERE aa.id = ?
      LIMIT 1
    `,
    [id]
  );
  return rows[0] || null;
}

async function findActivityForAnimal(animalId, { limit = 50 } = {}) {
  const [rows] = await pool.execute(
    `
      SELECT aa.*, u.first_name, u.last_name, u.name
      FROM animal_activity aa
      INNER JOIN users u ON u.user_id = aa.user_id
      WHERE aa.animal_id = ?
      ORDER BY aa.logged_at DESC
      LIMIT ?
    `,
    [animalId, Math.max(1, Math.min(Number(limit) || 50, 200))]
  );
  return rows;
}

async function findHelpedByUser(userId) {
  const [rows] = await pool.execute(
    `
      SELECT
        a.id,
        a.name,
        a.species,
        a.photo_filename,
        COUNT(*)::int AS activity_count,
        MAX(aa.logged_at) AS last_helped_at
      FROM animal_activity aa
      INNER JOIN animals a ON a.id = aa.animal_id
      WHERE aa.user_id = ?
      GROUP BY a.id, a.name, a.species, a.photo_filename
      ORDER BY last_helped_at DESC
    `,
    [userId]
  );
  return rows;
}

/**
 * Volunteer may log activity only with an accepted application on a shift
 * that includes this animal.
 */
async function assertCanLogActivity(userId, animalId, applicationId) {
  const [rows] = await pool.execute(
    `
      SELECT a.application_id, a.opportunity_id, a.status
      FROM applications a
      INNER JOIN opportunity_animals oa
        ON oa.opportunity_id = a.opportunity_id AND oa.animal_id = ?
      WHERE a.application_id = ?
        AND a.user_id = ?
        AND a.status IN ('accepted', 'approved')
      LIMIT 1
    `,
    [animalId, applicationId, userId]
  );
  return rows[0] || null;
}

module.exports = {
  SPECIES,
  STATUSES,
  ACTIVITY_TYPES,
  normalizeAnimalIds,
  create,
  findById,
  findAll,
  update,
  setPhoto,
  getPhoto,
  setStatus,
  findForOpportunity,
  setOpportunityAnimals,
  attachAnimals,
  findMissingQualificationsForUser,
  logActivity,
  findActivityById,
  findActivityForAnimal,
  findHelpedByUser,
  assertCanLogActivity,
};
