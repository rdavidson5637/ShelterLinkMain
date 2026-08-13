'use strict';

const { pool } = require('../config/database');

const TABLE = 'group_bookings';
const ALLOWED_STATUSES = new Set(['pending', 'confirmed', 'cancelled']);

function mapRow(row) {
  if (!row) return null;
  row.id = row.id;
  return row;
}

async function create({
  opportunityId,
  groupName,
  contactName,
  contactEmail,
  size,
  notes = null,
}) {
  const sql = `
    INSERT INTO ${TABLE}
      (opportunity_id, group_name, contact_name, contact_email, size, status, notes)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `;
  const [result] = await pool.execute(sql, [
    opportunityId,
    groupName,
    contactName,
    contactEmail,
    size,
    notes,
  ]);
  return findById(result.insertId);
}

async function findById(id) {
  const sql = `
    SELECT
      gb.*,
      o.title AS opportunity_title,
      o.start_date AS opportunity_start_date,
      o.location AS opportunity_location,
      o.max_volunteers
    FROM ${TABLE} gb
    LEFT JOIN opportunities o ON o.opportunity_id = gb.opportunity_id
    WHERE gb.id = ?
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [id]);
  return mapRow(rows[0] || null);
}

async function findAll({ status = null } = {}) {
  const clauses = [];
  const params = [];
  if (status) {
    clauses.push('gb.status = ?');
    params.push(status);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `
    SELECT
      gb.*,
      o.title AS opportunity_title,
      o.start_date AS opportunity_start_date,
      o.location AS opportunity_location,
      o.max_volunteers
    FROM ${TABLE} gb
    LEFT JOIN opportunities o ON o.opportunity_id = gb.opportunity_id
    ${where}
    ORDER BY
      FIELD(gb.status, 'pending', 'confirmed', 'cancelled'),
      gb.created_at DESC
  `;
  const [rows] = await pool.execute(sql, params);
  return rows.map(mapRow);
}

async function updateStatus(id, status) {
  if (!ALLOWED_STATUSES.has(status)) {
    throw new Error('Invalid group booking status');
  }
  const [result] = await pool.execute(
    `UPDATE ${TABLE} SET status = ? WHERE id = ?`,
    [status, id]
  );
  if (!result.affectedRows) return null;
  return findById(id);
}

async function sumConfirmedSize(opportunityId) {
  const [rows] = await pool.execute(
    `
      SELECT COALESCE(SUM(size), 0) AS total
      FROM ${TABLE}
      WHERE opportunity_id = ?
        AND status = 'confirmed'
    `,
    [opportunityId]
  );
  return Number(rows[0]?.total || 0);
}

module.exports = {
  create,
  findById,
  findAll,
  updateStatus,
  sumConfirmedSize,
  ALLOWED_STATUSES,
};
