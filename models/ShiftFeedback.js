'use strict';

const { pool } = require('../config/database');

const TABLE = 'shift_feedback';

function mapRow(row) {
  if (!row) return null;
  row.id = row.id;
  row.flag_concern = Boolean(row.flag_concern);
  return row;
}

async function create({ applicationId, rating, comment = null, flagConcern = false }) {
  const sql = `
    INSERT INTO ${TABLE} (application_id, rating, comment, flag_concern)
    VALUES (?, ?, ?, ?)
  `;
  const [result] = await pool.execute(sql, [
    applicationId,
    rating,
    comment || null,
    flagConcern ? 1 : 0,
  ]);
  return findById(result.insertId);
}

async function findById(id) {
  const sql = `
    SELECT
      f.id,
      f.application_id,
      f.rating,
      f.comment,
      f.flag_concern,
      f.handled_at,
      f.created_at,
      a.user_id,
      a.opportunity_id,
      u.email AS volunteer_email,
      u.name AS volunteer_name,
      o.title AS opportunity_title,
      o.start_date AS opportunity_start_date
    FROM ${TABLE} f
    INNER JOIN applications a ON a.application_id = f.application_id
    INNER JOIN users u ON u.user_id = a.user_id
    INNER JOIN opportunities o ON o.opportunity_id = a.opportunity_id
    WHERE f.id = ?
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [id]);
  return mapRow(rows[0] || null);
}

async function findByApplicationId(applicationId) {
  const sql = `
    SELECT
      f.id,
      f.application_id,
      f.rating,
      f.comment,
      f.flag_concern,
      f.handled_at,
      f.created_at
    FROM ${TABLE} f
    WHERE f.application_id = ?
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [applicationId]);
  return mapRow(rows[0] || null);
}

/**
 * List feedback with optional filters:
 * - opportunityId
 * - flagConcern (true/false)
 * - handled (true = has handled_at, false = concerns not yet handled)
 * - minRating / maxRating
 */
async function findAll(filters = {}) {
  const where = [];
  const params = [];

  if (filters.opportunityId) {
    where.push('a.opportunity_id = ?');
    params.push(Number(filters.opportunityId));
  }
  if (filters.flagConcern === true || filters.flagConcern === '1' || filters.flagConcern === 'true') {
    where.push('f.flag_concern = 1');
  } else if (filters.flagConcern === false || filters.flagConcern === '0' || filters.flagConcern === 'false') {
    where.push('f.flag_concern = 0');
  }
  if (filters.handled === true || filters.handled === '1' || filters.handled === 'true') {
    where.push('f.handled_at IS NOT NULL');
  } else if (filters.handled === false || filters.handled === '0' || filters.handled === 'false') {
    where.push('f.flag_concern = 1 AND f.handled_at IS NULL');
  }
  if (filters.minRating != null && filters.minRating !== '') {
    where.push('f.rating >= ?');
    params.push(Number(filters.minRating));
  }
  if (filters.maxRating != null && filters.maxRating !== '') {
    where.push('f.rating <= ?');
    params.push(Number(filters.maxRating));
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const sql = `
    SELECT
      f.id,
      f.application_id,
      f.rating,
      f.comment,
      f.flag_concern,
      f.handled_at,
      f.created_at,
      a.user_id,
      a.opportunity_id,
      u.email AS volunteer_email,
      u.name AS volunteer_name,
      o.title AS opportunity_title,
      o.start_date AS opportunity_start_date
    FROM ${TABLE} f
    INNER JOIN applications a ON a.application_id = f.application_id
    INNER JOIN users u ON u.user_id = a.user_id
    INNER JOIN opportunities o ON o.opportunity_id = a.opportunity_id
    ${whereSql}
    ORDER BY
      (f.flag_concern = 1 AND f.handled_at IS NULL) DESC,
      f.created_at DESC
  `;
  const [rows] = await pool.execute(sql, params);
  return rows.map(mapRow);
}

async function markHandled(id, when = new Date()) {
  const whenSql = when.toISOString().slice(0, 19).replace('T', ' ');
  const sql = `
    UPDATE ${TABLE}
    SET handled_at = ?
    WHERE id = ?
      AND flag_concern = 1
      AND handled_at IS NULL
  `;
  const [result] = await pool.execute(sql, [whenSql, id]);
  if (!result.affectedRows) return null;
  return findById(id);
}

/**
 * Accepted applications whose opportunity calendar date was yesterday
 * and that have not yet been emailed a feedback request.
 */
async function findAcceptedNeedingFeedbackRequest(now = new Date()) {
  const nowSql = now.toISOString().slice(0, 19).replace('T', ' ');
  const sql = `
    SELECT
      a.application_id,
      a.user_id,
      a.opportunity_id,
      a.status,
      a.feedback_requested_at,
      u.email,
      u.first_name,
      u.last_name,
      u.name,
      o.title AS opportunity_title,
      o.location AS opportunity_location,
      o.start_date AS opportunity_start_date
    FROM applications a
    INNER JOIN opportunities o ON o.opportunity_id = a.opportunity_id
    INNER JOIN users u ON u.user_id = a.user_id
    WHERE a.status IN ('accepted', 'approved')
      AND a.feedback_requested_at IS NULL
      AND o.start_date IS NOT NULL
      AND CAST(o.start_date AS date) = (?::date - interval '1 day')
    ORDER BY a.application_id ASC
  `;
  const [rows] = await pool.execute(sql, [nowSql]);
  return rows.map((row) => {
    row.id = row.application_id;
    return row;
  });
}

async function markFeedbackRequested(applicationId, when = new Date()) {
  const whenSql = when.toISOString().slice(0, 19).replace('T', ' ');
  const sql = `
    UPDATE applications
    SET feedback_requested_at = ?
    WHERE application_id = ?
      AND feedback_requested_at IS NULL
  `;
  const [result] = await pool.execute(sql, [whenSql, applicationId]);
  return result.affectedRows > 0;
}

/**
 * Past accepted applications for a volunteer, with feedback status.
 */
async function findPastShiftsForUser(userId, now = new Date()) {
  const nowSql = now.toISOString().slice(0, 19).replace('T', ' ');
  const sql = `
    SELECT
      a.application_id,
      a.opportunity_id,
      a.status,
      o.title AS opportunity_title,
      o.start_date AS opportunity_start_date,
      f.id AS feedback_id,
      f.rating AS feedback_rating
    FROM applications a
    INNER JOIN opportunities o ON o.opportunity_id = a.opportunity_id
    LEFT JOIN ${TABLE} f ON f.application_id = a.application_id
    WHERE a.user_id = ?
      AND a.status IN ('accepted', 'approved')
      AND o.start_date IS NOT NULL
      AND o.start_date < ?
    ORDER BY o.start_date DESC
  `;
  const [rows] = await pool.execute(sql, [userId, nowSql]);
  return rows.map((row) => {
    row.id = row.application_id;
    row.has_feedback = Boolean(row.feedback_id);
    return row;
  });
}

async function findAdminEmails() {
  const [rows] = await pool.execute(
    `SELECT email FROM users WHERE role = 'admin' AND email IS NOT NULL AND email <> ''`
  );
  return rows.map((r) => r.email).filter(Boolean);
}

module.exports = {
  create,
  findById,
  findByApplicationId,
  findAll,
  markHandled,
  findAcceptedNeedingFeedbackRequest,
  markFeedbackRequested,
  findPastShiftsForUser,
  findAdminEmails,
};
