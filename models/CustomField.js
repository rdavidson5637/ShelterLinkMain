'use strict';

const { pool } = require('../config/database');

const FIELD_TYPES = new Set(['text', 'select', 'checkbox', 'date']);

function parseOptions(raw) {
  if (raw == null || raw === '') return [];
  if (Array.isArray(raw)) {
    return raw.map((o) => String(o).trim()).filter(Boolean);
  }
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!Array.isArray(parsed)) return [];
    return parsed.map((o) => String(o).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

function serializeOptions(options) {
  if (!options || !options.length) return null;
  return JSON.stringify(options.map((o) => String(o).trim()).filter(Boolean));
}

function mapField(row) {
  if (!row) return null;
  return {
    id: row.id,
    label: row.label,
    field_type: row.field_type,
    options: parseOptions(row.options_json),
    options_json: row.options_json,
    required: Boolean(row.required),
    applies_to: row.applies_to || 'profile',
    sort_order: Number(row.sort_order) || 0,
    active: Boolean(row.active),
    created_at: row.created_at,
  };
}

function isEmptyValue(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'boolean') return false;
  if (typeof value === 'number') return false;
  return String(value).trim() === '';
}

/**
 * Normalise and validate a submitted value for a field definition.
 * Returns { ok, value, error }.
 */
function validateAndNormaliseValue(field, rawValue) {
  const required = Boolean(field.required);

  if (field.field_type === 'checkbox') {
    const truthy =
      rawValue === true ||
      rawValue === 1 ||
      rawValue === '1' ||
      String(rawValue).toLowerCase() === 'true' ||
      String(rawValue).toLowerCase() === 'yes' ||
      String(rawValue).toLowerCase() === 'on';
    const normalised = truthy ? '1' : '0';
    if (required && normalised !== '1') {
      return { ok: false, value: null, error: `"${field.label}" is required` };
    }
    return { ok: true, value: normalised, error: null };
  }

  if (isEmptyValue(rawValue)) {
    if (required) {
      return { ok: false, value: null, error: `"${field.label}" is required` };
    }
    return { ok: true, value: '', error: null };
  }

  const asString = String(rawValue).trim();

  if (field.field_type === 'select') {
    const options = field.options || parseOptions(field.options_json);
    if (!options.includes(asString)) {
      return {
        ok: false,
        value: null,
        error: `"${field.label}" must be one of: ${options.join(', ')}`,
      };
    }
    return { ok: true, value: asString, error: null };
  }

  if (field.field_type === 'date') {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(asString)) {
      return { ok: false, value: null, error: `"${field.label}" must be a valid date (YYYY-MM-DD)` };
    }
    return { ok: true, value: asString, error: null };
  }

  // text
  return { ok: true, value: asString, error: null };
}

/**
 * Validate a map of fieldId -> value against active profile fields.
 * valuesById may use string or number keys.
 */
function validateSubmittedValues(fields, valuesById = {}) {
  const errors = [];
  const normalised = {};

  for (const field of fields) {
    const key = String(field.id);
    const raw =
      valuesById[field.id] !== undefined
        ? valuesById[field.id]
        : valuesById[key];
    const result = validateAndNormaliseValue(field, raw);
    if (!result.ok) {
      errors.push(result.error);
    } else {
      normalised[field.id] = result.value;
    }
  }

  return { ok: errors.length === 0, errors, values: normalised };
}

async function findById(id) {
  const [rows] = await pool.execute(
    `SELECT id, label, field_type, options_json, required, applies_to, sort_order, active, created_at
     FROM custom_fields WHERE id = ? LIMIT 1`,
    [id]
  );
  return mapField(rows[0] || null);
}

async function findAll({ activeOnly = false } = {}) {
  const sql = `
    SELECT id, label, field_type, options_json, required, applies_to, sort_order, active, created_at
    FROM custom_fields
    ${activeOnly ? 'WHERE active = 1' : ''}
    ORDER BY sort_order ASC, id ASC
  `;
  const [rows] = await pool.execute(sql);
  return rows.map(mapField);
}

async function findActiveForProfile() {
  const [rows] = await pool.execute(
    `SELECT id, label, field_type, options_json, required, applies_to, sort_order, active, created_at
     FROM custom_fields
     WHERE active = 1 AND applies_to = 'profile'
     ORDER BY sort_order ASC, id ASC`
  );
  return rows.map(mapField);
}

async function nextSortOrder() {
  const [rows] = await pool.execute(
    `SELECT COALESCE(MAX(sort_order), -1) + 1 AS next_order FROM custom_fields`
  );
  return Number(rows[0]?.next_order) || 0;
}

async function create({
  label,
  field_type = 'text',
  options = [],
  required = false,
  applies_to = 'profile',
  sort_order = null,
  active = true,
} = {}) {
  const type = String(field_type || 'text').toLowerCase();
  if (!FIELD_TYPES.has(type)) {
    const err = new Error('Invalid field_type');
    err.status = 400;
    throw err;
  }

  const order = sort_order == null ? await nextSortOrder() : Number(sort_order);
  const optionsJson = type === 'select' ? serializeOptions(options) : null;

  const [result] = await pool.execute(
    `INSERT INTO custom_fields
      (label, field_type, options_json, required, applies_to, sort_order, active)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      String(label).trim(),
      type,
      optionsJson,
      required ? 1 : 0,
      applies_to || 'profile',
      Number.isFinite(order) ? order : 0,
      active ? 1 : 0,
    ]
  );
  return findById(result.insertId);
}

async function update(id, data = {}) {
  const fields = [];
  const params = [];

  if (typeof data.label !== 'undefined') {
    fields.push('label = ?');
    params.push(String(data.label).trim());
  }
  if (typeof data.field_type !== 'undefined') {
    const type = String(data.field_type).toLowerCase();
    if (!FIELD_TYPES.has(type)) {
      const err = new Error('Invalid field_type');
      err.status = 400;
      throw err;
    }
    fields.push('field_type = ?');
    params.push(type);
  }
  if (typeof data.options !== 'undefined' || typeof data.options_json !== 'undefined') {
    const opts =
      typeof data.options !== 'undefined'
        ? data.options
        : parseOptions(data.options_json);
    fields.push('options_json = ?');
    params.push(serializeOptions(opts));
  }
  if (typeof data.required !== 'undefined') {
    fields.push('required = ?');
    params.push(data.required ? 1 : 0);
  }
  if (typeof data.applies_to !== 'undefined') {
    fields.push('applies_to = ?');
    params.push(data.applies_to || 'profile');
  }
  if (typeof data.sort_order !== 'undefined') {
    fields.push('sort_order = ?');
    params.push(Number(data.sort_order) || 0);
  }
  if (typeof data.active !== 'undefined') {
    fields.push('active = ?');
    params.push(data.active ? 1 : 0);
  }

  if (!fields.length) {
    throw new Error('No custom field fields provided for update');
  }

  params.push(id);
  const [result] = await pool.execute(
    `UPDATE custom_fields SET ${fields.join(', ')} WHERE id = ?`,
    params
  );
  if (!result.affectedRows) return null;
  return findById(id);
}

async function deactivate(id) {
  return update(id, { active: false });
}

async function countValues(fieldId) {
  const [rows] = await pool.execute(
    `SELECT COUNT(*) AS cnt FROM custom_field_values WHERE field_id = ?`,
    [fieldId]
  );
  return Number(rows[0]?.cnt) || 0;
}

/**
 * Hard-delete only when no values exist; otherwise deactivate.
 * Returns { deleted: boolean, deactivated: boolean }.
 */
async function removeOrDeactivate(id) {
  const existing = await findById(id);
  if (!existing) return null;

  const valueCount = await countValues(id);
  if (valueCount > 0) {
    await deactivate(id);
    return { deleted: false, deactivated: true, field: await findById(id) };
  }

  const [result] = await pool.execute(`DELETE FROM custom_fields WHERE id = ?`, [id]);
  if (!result.affectedRows) return null;
  return { deleted: true, deactivated: false, field: existing };
}

async function reorder(orderedIds = []) {
  const ids = [...new Set(
    (orderedIds || [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0)
  )];

  for (let i = 0; i < ids.length; i += 1) {
    await pool.execute(`UPDATE custom_fields SET sort_order = ? WHERE id = ?`, [i, ids[i]]);
  }
  return findAll();
}

async function findValuesByUserId(userId) {
  const sql = `
    SELECT
      cfv.id,
      cfv.field_id,
      cfv.user_id,
      cfv.value,
      cf.label,
      cf.field_type,
      cf.options_json,
      cf.required,
      cf.sort_order,
      cf.active
    FROM custom_field_values cfv
    INNER JOIN custom_fields cf ON cf.id = cfv.field_id
    WHERE cfv.user_id = ?
    ORDER BY cf.sort_order ASC, cf.id ASC
  `;
  const [rows] = await pool.execute(sql, [userId]);
  return rows.map((row) => ({
    id: row.id,
    field_id: row.field_id,
    user_id: row.user_id,
    value: row.value,
    label: row.label,
    field_type: row.field_type,
    options: parseOptions(row.options_json),
    required: Boolean(row.required),
    sort_order: Number(row.sort_order) || 0,
    active: Boolean(row.active),
  }));
}

async function upsertValues(userId, valuesByFieldId = {}) {
  const entries = Object.entries(valuesByFieldId);
  for (const [fieldId, value] of entries) {
    await pool.execute(
      `INSERT INTO custom_field_values (field_id, user_id, value)
       VALUES (?, ?, ?)
       ON CONFLICT (field_id, user_id) DO UPDATE SET value = EXCLUDED.value`,
      [Number(fieldId), userId, value == null ? '' : String(value)]
    );
  }
  return findValuesByUserId(userId);
}

/**
 * Build a map of userId -> { [label]: value } for CSV export columns.
 */
async function findAllValuesGroupedByUser() {
  const fields = await findAll();
  const [rows] = await pool.execute(
    `SELECT field_id, user_id, value FROM custom_field_values`
  );

  const byUser = new Map();
  for (const row of rows) {
    if (!byUser.has(row.user_id)) byUser.set(row.user_id, {});
    byUser.get(row.user_id)[row.field_id] = row.value == null ? '' : String(row.value);
  }

  return { fields, byUser };
}

module.exports = {
  FIELD_TYPES,
  parseOptions,
  serializeOptions,
  mapField,
  validateAndNormaliseValue,
  validateSubmittedValues,
  isEmptyValue,
  findById,
  findAll,
  findActiveForProfile,
  create,
  update,
  deactivate,
  countValues,
  removeOrDeactivate,
  reorder,
  findValuesByUserId,
  upsertValues,
  findAllValuesGroupedByUser,
};
