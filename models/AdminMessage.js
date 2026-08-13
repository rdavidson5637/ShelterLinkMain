'use strict';

const { pool } = require('../config/database');

/**
 * Resolve volunteer recipients for admin bulk messaging.
 * Filters: profileStatus ('approved'|'pending'), skill (substring),
 * minApprovedHours (number), opportunityId (applied to).
 */
async function resolveRecipients(filters = {}) {
  const where = [`u.role = 'volunteer'`, `u.email IS NOT NULL`, `u.email <> ''`];
  const params = [];

  if (filters.profileStatus === 'approved') {
    where.push('COALESCE(vp.approved, 0) = 1');
  } else if (filters.profileStatus === 'pending') {
    where.push('COALESCE(vp.approved, 0) = 0');
  }

  if (filters.skill && String(filters.skill).trim()) {
    where.push('vp.skills LIKE ?');
    params.push(`%${String(filters.skill).trim()}%`);
  }

  if (filters.opportunityId) {
    where.push(`EXISTS (
      SELECT 1 FROM applications a
      WHERE a.user_id = u.user_id
        AND a.opportunity_id = ?
    )`);
    params.push(Number(filters.opportunityId));
  }

  const having = [];
  if (filters.minApprovedHours != null && filters.minApprovedHours !== '') {
    having.push('COALESCE(SUM(CASE WHEN vh.approved = 1 THEN vh.hours ELSE 0 END), 0) >= ?');
    params.push(Number(filters.minApprovedHours));
  }

  const sql = `
    SELECT
      u.user_id,
      u.email,
      u.first_name,
      u.last_name,
      COALESCE(SUM(CASE WHEN vh.approved = 1 THEN vh.hours ELSE 0 END), 0) AS approved_hours
    FROM users u
    LEFT JOIN volunteer_profiles vp ON vp.user_id = u.user_id
    LEFT JOIN volunteer_hours vh ON vh.user_id = u.user_id
    WHERE ${where.join(' AND ')}
    GROUP BY u.user_id, u.email, u.first_name, u.last_name
    ${having.length ? `HAVING ${having.join(' AND ')}` : ''}
    ORDER BY u.last_name, u.first_name
  `;

  const [rows] = await pool.execute(sql, params);
  return rows.map((row) => ({
    ...row,
    id: row.user_id,
  }));
}

async function createMessageLog({ adminId, subject, body, filter, recipientCount }) {
  const sql = `
    INSERT INTO admin_messages (admin_id, subject, body, filter_json, recipient_count)
    VALUES (?, ?, ?, ?, ?)
  `;
  const [result] = await pool.execute(sql, [
    adminId || null,
    subject,
    body,
    JSON.stringify(filter || {}),
    Number(recipientCount) || 0,
  ]);
  return findById(result.insertId);
}

async function findById(id) {
  const [rows] = await pool.execute(
    `SELECT * FROM admin_messages WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
}

async function findAll(limit = 50) {
  const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
  const [rows] = await pool.execute(
    `
      SELECT m.*, u.first_name, u.last_name, u.email AS admin_email
      FROM admin_messages m
      LEFT JOIN users u ON u.user_id = m.admin_id
      ORDER BY m.created_at DESC
      LIMIT ${safeLimit}
    `
  );
  return rows;
}

module.exports = {
  resolveRecipients,
  createMessageLog,
  findById,
  findAll,
};
