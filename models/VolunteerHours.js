const { pool } = require('../config/database');

const TABLE = 'volunteer_hours';

async function create(userId, opportunityId, date, hours, options = {}) {
  try {
    if (!userId || !date || typeof hours !== 'number') {
      throw new Error('userId, date, and hours are required');
    }

    const verified = options.verified_by_checkin ? 1 : 0;
    const sql = `
      INSERT INTO ${TABLE} (user_id, opportunity_id, date, hours, approved, verified_by_checkin)
      VALUES (?, ?, ?, ?, 0, ?)
    `;

    const [result] = await pool.execute(sql, [userId, opportunityId || null, date, hours, verified]);
    return findById(result.insertId);
  } catch (error) {
    console.error('[VolunteerHours] create error:', error.message);
    throw error;
  }
}

async function findById(hoursId) {
  try {
    const sql = `
      SELECT
        vh.record_id,
        vh.user_id,
        vh.opportunity_id,
        vh.date,
        vh.hours,
        vh.approved,
        vh.verified_by_checkin,
        o.title AS opportunity_title,
        o.location AS opportunity_location
      FROM ${TABLE} vh
      LEFT JOIN opportunities o ON o.opportunity_id = vh.opportunity_id
      WHERE vh.record_id = ?
      LIMIT 1
    `;
    const [rows] = await pool.execute(sql, [hoursId]);
    const result = rows[0] || null;
    if (result) {
      result.id = result.record_id;
    }
    return result;
  } catch (error) {
    console.error('[VolunteerHours] findById error:', error.message);
    throw error;
  }
}

async function findByUserId(userId) {
  try {
    if (!userId) throw new Error('userId is required');

    const sql = `
      SELECT
        vh.record_id,
        vh.user_id,
        vh.opportunity_id,
        vh.date,
        vh.hours,
        vh.approved,
        vh.verified_by_checkin,
        o.title AS opportunity_title,
        o.location AS opportunity_location,
        o.start_date AS opportunity_start_date,
        o.end_date AS opportunity_end_date
      FROM ${TABLE} vh
      LEFT JOIN opportunities o ON o.opportunity_id = vh.opportunity_id
      WHERE vh.user_id = ?
      ORDER BY vh.date DESC
    `;
    const [rows] = await pool.execute(sql, [userId]);
    return rows.map(row => {
      row.id = row.record_id;
      return row;
    });
  } catch (error) {
    console.error('[VolunteerHours] findByUserId error:', error.message);
    throw error;
  }
}

async function findByOpportunityId(opportunityId) {
  try {
    if (!opportunityId) throw new Error('opportunityId is required');

    const sql = `
      SELECT
        vh.record_id,
        vh.user_id,
        vh.opportunity_id,
        vh.date,
        vh.hours,
        vh.approved,
        u.name,
        u.email
      FROM ${TABLE} vh
      LEFT JOIN users u ON u.user_id = vh.user_id
      WHERE vh.opportunity_id = ?
      ORDER BY vh.date DESC
    `;
    const [rows] = await pool.execute(sql, [opportunityId]);
    return rows.map(row => {
      row.id = row.record_id;
      return row;
    });
  } catch (error) {
    console.error('[VolunteerHours] findByOpportunityId error:', error.message);
    throw error;
  }
}

async function findPending() {
  try {
    const sql = `
      SELECT
        vh.record_id,
        vh.user_id,
        vh.opportunity_id,
        vh.date,
        vh.hours,
        vh.approved,
        vh.verified_by_checkin,
        u.first_name,
        u.last_name,
        u.name,
        u.email,
        o.title AS opportunity_title,
        o.location AS opportunity_location
      FROM ${TABLE} vh
      LEFT JOIN users u ON u.user_id = vh.user_id
      LEFT JOIN opportunities o ON o.opportunity_id = vh.opportunity_id
      WHERE vh.approved = 0
      ORDER BY vh.date ASC
    `;
    const [rows] = await pool.execute(sql);
    return rows.map(row => {
      row.id = row.record_id;
      return row;
    });
  } catch (error) {
    console.error('[VolunteerHours] findPending error:', error.message);
    throw error;
  }
}

async function approve(hoursId) {
  const sql = `UPDATE ${TABLE} SET approved = 1 WHERE record_id = ?`;
  const [result] = await pool.execute(sql, [hoursId]);
  if (!result.affectedRows) return null;
  return findById(hoursId);
}

async function getTotalHours(userId) {
  try {
    if (!userId) throw new Error('userId is required');

    const sql = `
      SELECT COALESCE(SUM(hours), 0) AS total_hours
      FROM ${TABLE}
      WHERE user_id = ? AND approved = 1
    `;
    const [rows] = await pool.execute(sql, [userId]);
    return rows[0]?.total_hours || 0;
  } catch (error) {
    console.error('[VolunteerHours] getTotalHours error:', error.message);
    throw error;
  }
}

module.exports = {
  create,
  findById,
  findByUserId,
  findByOpportunityId,
  findPending,
  approve,
  getTotalHours,
};