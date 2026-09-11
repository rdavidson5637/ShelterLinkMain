const { pool } = require('../config/database');

const TABLE = 'volunteer_profiles';
const HOME_TYPES = new Set(['house', 'flat', 'other']);
const FOSTER_SIZES = new Set(['small', 'medium', 'large']);
const FOSTER_BOOL_FIELDS = new Set([
  'has_garden',
  'garden_secure',
  'has_other_dogs',
  'has_other_cats',
  'has_children_under_16',
  'can_medicate',
]);
const NOTIFICATION_PREF_FIELDS = new Set([
  'prefer_urgent',
  'prefer_reminders',
  'prefer_threads',
  'prefer_fosters',
]);

const ALLOWED_PROFILE_FIELDS = new Set([
  'date_of_birth',
  'address',
  'emergency_contact',
  'skills',
  'availability',
  'home_type',
  'has_garden',
  'garden_secure',
  'has_other_dogs',
  'has_other_cats',
  'has_children_under_16',
  'can_medicate',
  'max_foster_size',
  'foster_notes',
  'away_until',
  'prefer_urgent',
  'prefer_reminders',
  'prefer_threads',
  'prefer_fosters',
]);

/**
 * True when profile.away_until is set and is on or after the given date (YYYY-MM-DD).
 */
function isAway(profile, date = new Date()) {
  if (!profile || profile.away_until == null || profile.away_until === '') return false;
  const until = String(profile.away_until).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(until)) return false;
  let day;
  if (date instanceof Date) {
    if (Number.isNaN(date.getTime())) return false;
    day = date.toISOString().slice(0, 10);
  } else {
    day = String(date).slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  return until >= day;
}

function coerceFosterBool(value) {
  if (value === null || value === '') return null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  const n = Number(value);
  if (n === 0 || n === 1) return n;
  return null;
}

function sanitizeProfileData(profileData = {}) {
  const sanitized = {};
  Object.entries(profileData).forEach(([key, value]) => {
    if (!ALLOWED_PROFILE_FIELDS.has(key)) return;

    if (key === 'home_type') {
      if (value == null || value === '') {
        sanitized[key] = null;
      } else if (HOME_TYPES.has(value)) {
        sanitized[key] = value;
      }
      return;
    }

    if (key === 'max_foster_size') {
      if (value == null || value === '') {
        sanitized[key] = null;
      } else if (FOSTER_SIZES.has(value)) {
        sanitized[key] = value;
      }
      return;
    }

    if (FOSTER_BOOL_FIELDS.has(key)) {
      sanitized[key] = coerceFosterBool(value);
      return;
    }

    if (NOTIFICATION_PREF_FIELDS.has(key)) {
      const n = Number(value);
      sanitized[key] = n === 1 ? 1 : 0;
      return;
    }

    if (key === 'away_until') {
      if (value == null || value === '') {
        sanitized[key] = null;
      } else {
        const day = String(value).slice(0, 10);
        if (/^\d{4}-\d{2}-\d{2}$/.test(day)) {
          sanitized[key] = day;
        }
      }
      return;
    }

    sanitized[key] = value;
  });
  return sanitized;
}

function buildUpdateClause(data = {}) {
  const entries = Object.entries(sanitizeProfileData(data)).filter(
    ([, value]) => typeof value !== 'undefined'
  );

  if (!entries.length) {
    throw new Error('No profile fields provided for update');
  }

  const assignments = entries.map(([key]) => `${key} = ?`);
  const values = entries.map(([, value]) => value);

  return {
    clause: assignments.join(', '),
    values,
  };
}

async function create(userId, profileData = {}) {
  if (!userId) throw new Error('userId is required');

  const sanitized = sanitizeProfileData(profileData);
  const dynamicKeys = Object.keys(sanitized);

  const columns = ['user_id', ...dynamicKeys];
  const placeholders = columns.map(() => '?');
  const values = [userId, ...dynamicKeys.map((key) => sanitized[key])];

  const sql = `
    INSERT INTO ${TABLE} (${columns.join(', ')})
    VALUES (${placeholders.join(', ')})
  `;

  await pool.execute(sql, values);
  return findByUserId(userId);
}

async function findByUserId(userId) {
  if (!userId) throw new Error('userId is required');

  const sql = `
    SELECT vp.*, u.name AS user_name, u.email AS user_email, u.phone AS phone
    FROM ${TABLE} vp
    LEFT JOIN users u ON u.user_id = vp.user_id
    WHERE vp.user_id = ?
    LIMIT 1
  `;

  const [rows] = await pool.execute(sql, [userId]);
  return rows[0] || null;
}

async function update(userId, profileData = {}) {
  if (!userId) throw new Error('userId is required');

  const { clause, values } = buildUpdateClause(profileData);
  const sql = `UPDATE ${TABLE} SET ${clause} WHERE user_id = ?`;

  const params = [...values, userId];
  const [result] = await pool.execute(sql, params);

  if (!result.affectedRows) {
    return null;
  }

  return findByUserId(userId);
}

async function updateApprovalStatus(userId, approved) {
  if (!userId) throw new Error('userId is required');

  const sql = `UPDATE ${TABLE} SET approved = ? WHERE user_id = ?`;
  const [result] = await pool.execute(sql, [approved ? 1 : 0, userId]);

  if (!result.affectedRows) {
    return null;
  }

  return findByUserId(userId);
}

async function updateFosterApproved(userId, fosterApproved) {
  if (!userId) throw new Error('userId is required');

  const sql = `UPDATE ${TABLE} SET foster_approved = ? WHERE user_id = ?`;
  const [result] = await pool.execute(sql, [fosterApproved ? 1 : 0, userId]);

  if (!result.affectedRows) {
    return null;
  }

  return findByUserId(userId);
}

const ALLOWED_VOLUNTEER_TYPES = new Set(['regular', 'community_service', 'corporate_group']);

async function updateServiceSettings(userId, { volunteerType, requiredHours } = {}) {
  if (!userId) throw new Error('userId is required');

  const assignments = [];
  const values = [];

  if (typeof volunteerType !== 'undefined') {
    if (!ALLOWED_VOLUNTEER_TYPES.has(volunteerType)) {
      throw new Error('Invalid volunteer_type');
    }
    assignments.push('volunteer_type = ?');
    values.push(volunteerType);
  }

  if (typeof requiredHours !== 'undefined') {
    if (requiredHours === null || requiredHours === '') {
      assignments.push('required_hours = NULL');
    } else {
      const hours = Number(requiredHours);
      if (!Number.isFinite(hours) || hours < 0) {
        throw new Error('required_hours must be a non-negative number');
      }
      assignments.push('required_hours = ?');
      values.push(hours);
    }
  }

  if (!assignments.length) {
    throw new Error('No service settings provided');
  }

  const sql = `UPDATE ${TABLE} SET ${assignments.join(', ')} WHERE user_id = ?`;
  const [result] = await pool.execute(sql, [...values, userId]);
  if (!result.affectedRows) return null;
  return findByUserId(userId);
}

module.exports = {
  create,
  findByUserId,
  update,
  updateApprovalStatus,
  updateFosterApproved,
  updateServiceSettings,
  isAway,
  ALLOWED_VOLUNTEER_TYPES,
  ALLOWED_PROFILE_FIELDS,
  HOME_TYPES,
  FOSTER_SIZES,
};


