const { pool } = require('../config/database');

const TABLE = 'opportunities';
const MAX_OCCURRENCES = 26;
const ALLOWED_UPDATE_FIELDS = new Set([
  'title',
  'description',
  'requirements',
  'location',
  'start_date',
  'end_date',
  'max_volunteers',
  'cancellation_cutoff_hours',
  'required_background_check_type',
]);

const SELECT_COLUMNS = `
  opportunity_id,
  title,
  description,
  requirements,
  location,
  start_date,
  end_date,
  max_volunteers,
  status,
  recurrence_rule,
  recurrence_until,
  parent_opportunity_id,
  check_in_code,
  cancellation_cutoff_hours,
  activity_notes,
  is_urgent,
  urgent_flagged_at,
  required_background_check_type,
  (
    (
      SELECT COUNT(*)
      FROM applications a
      WHERE a.opportunity_id = opportunities.opportunity_id
        AND a.status IN ('accepted', 'approved')
    )
    +
    (
      SELECT COALESCE(SUM(gb.size), 0)
      FROM group_bookings gb
      WHERE gb.opportunity_id = opportunities.opportunity_id
        AND gb.status = 'confirmed'
    )
  ) AS spots_filled
`;

function generateCheckInCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet[Math.floor(Math.random() * alphabet.length)];
  }
  return code;
}

function sanitizeUpdatableFields(data = {}) {
  const copy = {};
  Object.entries(data).forEach(([key, value]) => {
    if (ALLOWED_UPDATE_FIELDS.has(key)) {
      copy[key] = value;
    }
  });
  return copy;
}

function buildUpdateSetClause(data = {}) {
  const entries = Object.entries(sanitizeUpdatableFields(data)).filter(
    ([, value]) => typeof value !== 'undefined'
  );

  if (!entries.length) {
    throw new Error('No opportunity fields provided for update');
  }

  const clause = entries.map(([key]) => `${key} = ?`).join(', ');
  const values = entries.map(([, value]) => value);
  return { clause, values };
}

function mapRow(row) {
  if (!row) return null;
  row.id = row.opportunity_id;
  return row;
}

function pad2(n) {
  return String(n).padStart(2, '0');
}

function shiftDateValue(value, days) {
  if (!value) return null;
  const asString = String(value).trim();
  const match = asString.match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (!match) {
    throw new Error('Invalid date');
  }

  const [, y, m, d, hh, mm, ss] = match;
  const date = new Date(Date.UTC(Number(y), Number(m) - 1, Number(d)));
  date.setUTCDate(date.getUTCDate() + days);
  const datePart = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`;

  if (hh === undefined) {
    return datePart;
  }
  return `${datePart} ${hh}:${mm}:${ss || '00'}`;
}

function dayStepForRule(rule) {
  if (rule === 'daily') return 1;
  if (rule === 'weekly') return 7;
  return null;
}

function toDateOnly(value) {
  if (!value) return null;
  return String(value).slice(0, 10);
}

/**
 * Build occurrence date offsets (in days from the parent start) for children only.
 * Parent is occurrence 1; total including parent is capped at MAX_OCCURRENCES.
 */
function buildOccurrenceOffsets(rule, startDate, untilDate) {
  const step = dayStepForRule(rule);
  if (!step) return [];

  const startDay = toDateOnly(startDate);
  const untilDay = toDateOnly(untilDate);
  if (!startDay || !untilDay) return [];

  const offsets = [];
  let offset = step;
  // Parent counts as 1; generate up to MAX_OCCURRENCES - 1 children.
  while (offsets.length < MAX_OCCURRENCES - 1) {
    const nextStart = shiftDateValue(startDay, offset);
    if (toDateOnly(nextStart) > untilDay) break;
    offsets.push(offset);
    offset += step;
  }
  return offsets;
}

async function create(opportunityData = {}) {
  try {
    const {
      title,
      description,
      requirements,
      location,
      start_date,
      end_date,
      max_volunteers,
      status = 'open',
      created_by = null,
      recurrence_rule = 'none',
      recurrence_until = null,
      parent_opportunity_id = null,
      check_in_code = null,
      cancellation_cutoff_hours = 24,
      required_background_check_type = null,
    } = opportunityData;

    const cutoff = Number(cancellation_cutoff_hours);
    const safeCutoff = Number.isFinite(cutoff) && cutoff >= 0 ? Math.floor(cutoff) : 24;
    const bgType =
      required_background_check_type == null || required_background_check_type === ''
        ? null
        : required_background_check_type;

    const sql = `
      INSERT INTO ${TABLE}
        (title, description, requirements, location, start_date, end_date, max_volunteers, status, created_by,
         recurrence_rule, recurrence_until, parent_opportunity_id, check_in_code, cancellation_cutoff_hours,
         required_background_check_type)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `;

    const params = [
      title || null,
      description || null,
      requirements || null,
      location || null,
      start_date || null,
      end_date || null,
      max_volunteers || null,
      status || 'open',
      created_by,
      recurrence_rule || 'none',
      recurrence_until || null,
      parent_opportunity_id || null,
      check_in_code || generateCheckInCode(),
      safeCutoff,
      bgType,
    ];

    const [result] = await pool.execute(sql, params);
    return findById(result.insertId);
  } catch (error) {
    console.error('[Opportunity] create error:', error.message);
    throw error;
  }
}

/**
 * Create a parent opportunity and generate recurring children (max 26 total).
 * Returns { parent, children, total }.
 */
async function createWithRecurrence(opportunityData = {}) {
  const rule = opportunityData.recurrence_rule || 'none';
  const until = opportunityData.recurrence_until || null;

  if (rule === 'none' || !until) {
    const parent = await create({
      ...opportunityData,
      recurrence_rule: 'none',
      recurrence_until: null,
      parent_opportunity_id: null,
    });
    return { parent, children: [], total: 1 };
  }

  const parent = await create({
    ...opportunityData,
    recurrence_rule: rule,
    recurrence_until: until,
    parent_opportunity_id: null,
  });

  const offsets = buildOccurrenceOffsets(rule, opportunityData.start_date, until);
  const children = [];

  for (const offset of offsets) {
    const child = await create({
      title: opportunityData.title,
      description: opportunityData.description,
      requirements: opportunityData.requirements,
      location: opportunityData.location,
      start_date: shiftDateValue(opportunityData.start_date, offset),
      end_date: shiftDateValue(opportunityData.end_date, offset),
      max_volunteers: opportunityData.max_volunteers,
      status: opportunityData.status || 'open',
      created_by: opportunityData.created_by,
      recurrence_rule: 'none',
      recurrence_until: null,
      parent_opportunity_id: parent.opportunity_id,
      cancellation_cutoff_hours: opportunityData.cancellation_cutoff_hours,
      required_background_check_type: opportunityData.required_background_check_type,
    });
    children.push(child);
  }

  return { parent, children, total: 1 + children.length };
}

async function findAll(filters = {}) {
  try {
    const { status } = filters;
    const whereClauses = [];
    const params = [];

    if (status) {
      whereClauses.push('status = ?');
      params.push(status);
    }

    const sql = `
      SELECT
        ${SELECT_COLUMNS}
      FROM ${TABLE}
      ${whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''}
      ORDER BY COALESCE(is_urgent, 0) DESC, start_date ASC NULLS LAST, opportunity_id DESC
    `;

    const [rows] = await pool.execute(sql, params);
    return rows.map(mapRow);
  } catch (error) {
    console.error('[Opportunity] findAll error:', error.message);
    throw error;
  }
}

async function findById(opportunityId) {
  try {
    const sql = `
      SELECT
        ${SELECT_COLUMNS}
      FROM ${TABLE}
      WHERE opportunity_id = ?
      LIMIT 1
    `;

    const [rows] = await pool.execute(sql, [opportunityId]);
    return mapRow(rows[0] || null);
  } catch (error) {
    console.error('[Opportunity] findById error:', error.message);
    throw error;
  }
}

async function update(opportunityId, data = {}) {
  try {
    const { clause, values } = buildUpdateSetClause(data);
    const sql = `
      UPDATE ${TABLE}
      SET ${clause}
      WHERE opportunity_id = ?
    `;
    const params = [...values, opportunityId];
    const [result] = await pool.execute(sql, params);
    if (!result.affectedRows) return null;
    return findById(opportunityId);
  } catch (error) {
    console.error('[Opportunity] update error:', error.message);
    throw error;
  }
}

async function updateStatus(opportunityId, status) {
  try {
    const sql = `
      UPDATE ${TABLE}
      SET status = ?
      WHERE opportunity_id = ?
    `;
    const [result] = await pool.execute(sql, [status, opportunityId]);
    if (!result.affectedRows) return null;
    return findById(opportunityId);
  } catch (error) {
    console.error('[Opportunity] updateStatus error:', error.message);
    throw error;
  }
}

async function getCurrentCapacity(opportunityId) {
  try {
    // Accepted applications + confirmed group booking sizes.
    const sql = `
      SELECT (
        (
          SELECT COUNT(*)
          FROM applications
          WHERE opportunity_id = ?
            AND status IN ('accepted', 'approved')
        )
        +
        (
          SELECT COALESCE(SUM(size), 0)
          FROM group_bookings
          WHERE opportunity_id = ?
            AND status = 'confirmed'
        )
      ) AS current_count
    `;
    const [rows] = await pool.execute(sql, [opportunityId, opportunityId]);
    return Number(rows[0]?.current_count || 0);
  } catch (error) {
    console.error('[Opportunity] getCurrentCapacity error:', error.message);
    throw error;
  }
}

/**
 * Append a line to the opportunity activity_notes log (admin-visible).
 */
async function appendActivityNote(opportunityId, note, when = new Date()) {
  if (!opportunityId || !note) return null;
  const stamp = when.toISOString().slice(0, 19).replace('T', ' ');
  const line = `[${stamp}] ${note}`;
  const sql = `
    UPDATE ${TABLE}
    SET activity_notes = CASE
      WHEN activity_notes IS NULL OR activity_notes = '' THEN ?
      ELSE CONCAT(activity_notes, '\n', ?)
    END
    WHERE opportunity_id = ?
  `;
  const [result] = await pool.execute(sql, [line, line, opportunityId]);
  if (!result.affectedRows) return null;
  return findById(opportunityId);
}

async function findSeriesMembers(opportunityId) {
  const opportunity = await findById(opportunityId);
  if (!opportunity) return { rootId: null, members: [] };

  const rootId = opportunity.parent_opportunity_id || opportunity.opportunity_id;
  const sql = `
    SELECT opportunity_id, parent_opportunity_id, title, status
    FROM ${TABLE}
    WHERE opportunity_id = ? OR parent_opportunity_id = ?
    ORDER BY start_date ASC, opportunity_id ASC
  `;
  const [rows] = await pool.execute(sql, [rootId, rootId]);
  return { rootId, members: rows };
}

/**
 * Copy an opportunity as a new draft (dates cleared, fresh check-in code).
 * Does not copy applications. Caller should copy tags / qualifications / animals.
 */
async function cloneFrom(sourceId, createdBy = null) {
  const source = await findById(sourceId);
  if (!source) return null;

  return create({
    title: source.title,
    description: source.description,
    requirements: source.requirements,
    location: source.location,
    start_date: null,
    end_date: null,
    max_volunteers: source.max_volunteers,
    status: 'open',
    created_by: createdBy,
    recurrence_rule: 'none',
    recurrence_until: null,
    parent_opportunity_id: null,
    check_in_code: generateCheckInCode(),
    cancellation_cutoff_hours: source.cancellation_cutoff_hours,
    required_background_check_type: source.required_background_check_type || null,
  });
}

/**
 * Approved, emailable volunteers who are fully qualified for the shift
 * and have not already applied. Used for urgent cover broadcasts.
 */
async function resolveUrgentCoverRecipients(opportunityId, { limit = 200 } = {}) {
  const safeLimit = Math.min(Math.max(Number(limit) || 200, 1), 200);
  const sql = `
    SELECT
      u.user_id,
      u.email,
      u.first_name,
      u.last_name
    FROM users u
    INNER JOIN volunteer_profiles vp ON vp.user_id = u.user_id
    WHERE u.role = 'volunteer'
      AND COALESCE(vp.approved, 0) = 1
      AND u.email IS NOT NULL
      AND u.email <> ''
      AND (vp.away_until IS NULL OR vp.away_until < CURRENT_DATE)
      AND NOT EXISTS (
        SELECT 1 FROM applications a
        WHERE a.user_id = u.user_id
          AND a.opportunity_id = ?
      )
      AND NOT EXISTS (
        SELECT 1
        FROM opportunity_qualifications oq
        WHERE oq.opportunity_id = ?
          AND NOT EXISTS (
            SELECT 1
            FROM volunteer_qualifications vq
            WHERE vq.user_id = u.user_id
              AND vq.qualification_id = oq.qualification_id
              AND (vq.expires_at IS NULL OR vq.expires_at >= CURRENT_DATE)
          )
      )
      AND NOT EXISTS (
        SELECT 1
        FROM opportunity_animals oa
        INNER JOIN animals an ON an.id = oa.animal_id
        WHERE oa.opportunity_id = ?
          AND an.requires_qualification_id IS NOT NULL
          AND NOT EXISTS (
            SELECT 1
            FROM volunteer_qualifications vq
            WHERE vq.user_id = u.user_id
              AND vq.qualification_id = an.requires_qualification_id
              AND (vq.expires_at IS NULL OR vq.expires_at >= CURRENT_DATE)
          )
      )
    ORDER BY u.last_name ASC, u.first_name ASC
    LIMIT ${safeLimit}
  `;
  const [rows] = await pool.execute(sql, [
    opportunityId,
    opportunityId,
    opportunityId,
  ]);
  return rows.map((row) => ({ ...row, id: row.user_id }));
}

function isUnderstaffed(opportunity) {
  if (!opportunity) return false;
  const max = Number(opportunity.max_volunteers);
  if (!Number.isFinite(max) || max <= 0) return true;
  const filled = Number(opportunity.spots_filled || 0);
  return filled < max;
}

function isUpcoming(opportunity, now = new Date()) {
  if (!opportunity) return false;
  const end = opportunity.end_date || opportunity.start_date;
  if (!end) return true;
  const endDate = new Date(end);
  if (Number.isNaN(endDate.getTime())) return true;
  return endDate.getTime() >= now.getTime() - 60 * 60 * 1000;
}

function canReflagUrgent(opportunity, now = new Date()) {
  if (!opportunity || !opportunity.urgent_flagged_at) return true;
  const flagged = new Date(opportunity.urgent_flagged_at);
  if (Number.isNaN(flagged.getTime())) return true;
  return now.getTime() - flagged.getTime() >= 24 * 60 * 60 * 1000;
}

async function flagUrgent(opportunityId, when = new Date()) {
  const stamp = when.toISOString().slice(0, 19).replace('T', ' ');
  const [result] = await pool.execute(
    `
      UPDATE ${TABLE}
      SET is_urgent = 1, urgent_flagged_at = ?
      WHERE opportunity_id = ?
    `,
    [stamp, opportunityId]
  );
  if (!result.affectedRows) return null;
  return findById(opportunityId);
}

/**
 * Hard-delete a series: parent + children that have no accepted/approved applications.
 * Opportunities with accepted applications are skipped.
 */
async function deleteSeries(opportunityId) {
  const { members } = await findSeriesMembers(opportunityId);
  if (!members.length) {
    return { deleted: 0, skipped: 0, skippedIds: [] };
  }

  let deleted = 0;
  let skipped = 0;
  const skippedIds = [];

  for (const member of members) {
    const capacity = await getCurrentCapacity(member.opportunity_id);
    if (capacity > 0) {
      skipped += 1;
      skippedIds.push(member.opportunity_id);
      continue;
    }

    const [result] = await pool.execute(
      `DELETE FROM ${TABLE} WHERE opportunity_id = ?`,
      [member.opportunity_id]
    );
    if (result.affectedRows) {
      deleted += 1;
    }
  }

  return { deleted, skipped, skippedIds };
}

module.exports = {
  create,
  createWithRecurrence,
  findAll,
  findById,
  update,
  updateStatus,
  getCurrentCapacity,
  appendActivityNote,
  findSeriesMembers,
  deleteSeries,
  cloneFrom,
  resolveUrgentCoverRecipients,
  isUnderstaffed,
  isUpcoming,
  canReflagUrgent,
  flagUrgent,
  buildOccurrenceOffsets,
  generateCheckInCode,
  MAX_OCCURRENCES,
};
