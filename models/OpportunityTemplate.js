'use strict';

const { pool } = require('../config/database');

function parsePayload(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(String(raw));
  } catch {
    return {};
  }
}

function mapRow(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    name: row.name,
    payload: parsePayload(row.payload_json),
    payload_json: row.payload_json,
    created_by: row.created_by != null ? Number(row.created_by) : null,
    created_at: row.created_at,
  };
}

async function create({ name, payload, createdBy = null } = {}) {
  if (!name || !String(name).trim()) throw new Error('name is required');
  const payloadObj = payload && typeof payload === 'object' ? payload : {};
  const payloadJson = JSON.stringify(payloadObj);
  const [result] = await pool.execute(
    `
      INSERT INTO opportunity_templates (name, payload_json, created_by)
      VALUES (?, ?, ?)
    `,
    [String(name).trim(), payloadJson, createdBy]
  );
  return findById(result.insertId);
}

async function findById(id) {
  const [rows] = await pool.execute(
    `SELECT * FROM opportunity_templates WHERE id = ? LIMIT 1`,
    [id]
  );
  return mapRow(rows[0] || null);
}

async function listAll() {
  const [rows] = await pool.execute(
    `
      SELECT *
      FROM opportunity_templates
      ORDER BY name ASC, id ASC
    `
  );
  return rows.map(mapRow);
}

async function remove(id) {
  const [result] = await pool.execute(
    `DELETE FROM opportunity_templates WHERE id = ?`,
    [id]
  );
  return Number(result.affectedRows) > 0;
}

module.exports = {
  create,
  findById,
  listAll,
  remove,
  parsePayload,
  mapRow,
};
