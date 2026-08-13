const { pool } = require('../config/database');

const TABLE = 'volunteer_profiles';
const ALLOWED_PROFILE_FIELDS = new Set([
  'date_of_birth',
  'address',
  'emergency_contact',
  'skills',
  'availability',
]);

function sanitizeProfileData(profileData = {}) {
  const sanitized = {};
  Object.entries(profileData).forEach(([key, value]) => {
    if (ALLOWED_PROFILE_FIELDS.has(key)) {
      sanitized[key] = value;
    }
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

  const assignments = entries.map(([key]) => `\`${key}\` = ?`);
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
    INSERT INTO ${TABLE} (${columns.map((col) => `\`${col}\``).join(', ')})
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
  updateServiceSettings,
  ALLOWED_VOLUNTEER_TYPES,
};


