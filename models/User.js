const { pool } = require('../config/database');
const bcrypt = require('bcrypt');

const SALT_ROUNDS = 10;

function toSafeUser(row) {
  if (!row) return null;
  // Never include password in returned objects
  const { password, ...safe } = row;
  // Split name into first_name and last_name for frontend compatibility
  if (safe.name) {
    const nameParts = safe.name.trim().split(/\s+/);
    safe.first_name = nameParts[0] || '';
    safe.last_name = nameParts.slice(1).join(' ') || '';
  }
  return safe;
}

async function create(userData) {
  const {
    first_name,
    last_name,
    email,
    password,
    role = 'volunteer',
  } = userData;

  // Combine first_name and last_name into name
  const name = [first_name, last_name].filter(Boolean).join(' ').trim() || null;
  const passwordHash = await bcrypt.hash(String(password), SALT_ROUNDS);

  const sql = `
    INSERT INTO users (name, email, password, role, created_at)
    VALUES (?, ?, ?, ?, NOW())
  `;

  const params = [name, email, passwordHash, role];
  const [result] = await pool.execute(sql, params);

  return findById(result.insertId);
}

async function findByEmail(email) {
  const [rows] = await pool.execute(
    `SELECT user_id, name, email, password, role, created_at
     FROM users
     WHERE email = ?
     LIMIT 1`,
    [email]
  );
  return rows[0] || null;
}

async function findById(userId) {
  const [rows] = await pool.execute(
    `SELECT user_id, name, email, role, created_at
     FROM users
     WHERE user_id = ?
     LIMIT 1`,
    [userId]
  );
  return toSafeUser(rows[0]);
}

async function comparePassword(plainPassword, hashedPassword) {
  return bcrypt.compare(String(plainPassword), String(hashedPassword));
}

module.exports = {
  create,
  findByEmail,
  findById,
  comparePassword,
  // Internal mapping helper (not exported publicly)
  _toSafeUser: toSafeUser,
};


