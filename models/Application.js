const { pool } = require('../config/database');
const { nowLocalSql } = require('../utils/shelterTime');

const TABLE = 'applications';

async function create(userId, opportunityId, status = 'pending') {
  try {
    if (!userId || !opportunityId) {
      throw new Error('userId and opportunityId are required');
    }

    const allowed = new Set(['pending', 'waitlisted']);
    const initialStatus = allowed.has(status) ? status : 'pending';

    const sql = `
      INSERT INTO ${TABLE} (user_id, opportunity_id, status)
      VALUES (?, ?, ?)
    `;

    const [result] = await pool.execute(sql, [userId, opportunityId, initialStatus]);
    const [rows] = await pool.execute(
      `
        SELECT a.*, o.title, o.location, o.start_date, o.end_date
        FROM ${TABLE} a
        LEFT JOIN opportunities o ON o.opportunity_id = a.opportunity_id
        WHERE a.application_id = ?
        LIMIT 1
      `,
      [result.insertId]
    );
    const result_app = rows[0] || null;
    if (result_app) {
      result_app.id = result_app.application_id;
      result_app.created_at = result_app.applied_at;
    }
    return result_app;
  } catch (error) {
    console.error('[Application] create error:', error.message);
    throw error;
  }
}

async function findByUserId(userId) {
  try {
    const sql = `
      SELECT
        a.application_id,
        a.user_id,
        a.opportunity_id,
        a.status,
        a.applied_at,
        a.rejection_reason,
        a.notes,
        o.title AS opportunity_title,
        o.location AS opportunity_location,
        o.start_date AS opportunity_start_date,
        o.end_date AS opportunity_end_date,
        o.cancellation_cutoff_hours,
        o.check_in_code,
        (
          SELECT s.id
          FROM swap_requests s
          WHERE s.application_id = a.application_id
            AND s.status = 'open'
          ORDER BY s.requested_at DESC
          LIMIT 1
        ) AS open_swap_id,
        CASE
          WHEN a.status = 'waitlisted' THEN (
            SELECT COUNT(*) + 1
            FROM applications w
            WHERE w.opportunity_id = a.opportunity_id
              AND w.status = 'waitlisted'
              AND (
                w.applied_at < a.applied_at
                OR (w.applied_at = a.applied_at AND w.application_id < a.application_id)
              )
          )
          ELSE NULL
        END AS waitlist_position,
        a.checked_in_at,
        a.checked_out_at
      FROM ${TABLE} a
      LEFT JOIN opportunities o ON o.opportunity_id = a.opportunity_id
      WHERE a.user_id = ?
      ORDER BY a.applied_at DESC
    `;
    const [rows] = await pool.execute(sql, [userId]);
    return rows.map(row => {
      row.id = row.application_id;
      row.created_at = row.applied_at;
      return row;
    });
  } catch (error) {
    console.error('[Application] findByUserId error:', error.message);
    throw error;
  }
}

async function findByOpportunityId(opportunityId) {
  try {
    const sql = `
      SELECT
        a.application_id,
        a.user_id,
        a.opportunity_id,
        a.status,
        a.applied_at,
        u.name,
        u.email
      FROM ${TABLE} a
      LEFT JOIN users u ON u.user_id = a.user_id
      WHERE a.opportunity_id = ?
      ORDER BY a.applied_at DESC
    `;
    const [rows] = await pool.execute(sql, [opportunityId]);
    return rows.map(row => {
      row.id = row.application_id;
      row.created_at = row.applied_at;
      return row;
    });
  } catch (error) {
    console.error('[Application] findByOpportunityId error:', error.message);
    throw error;
  }
}

async function findAll(filters = {}) {
  try {
    const { status } = filters;
    const whereClauses = [];
    const params = [];

    if (status) {
      whereClauses.push('a.status = ?');
      params.push(status);
    }

    const sql = `
        SELECT
          a.application_id,
          a.user_id,
          a.opportunity_id,
          a.status,
          a.applied_at,
          a.rejection_reason,
          a.notes,
          a.reminder_sent_at,
          a.no_show,
          u.first_name,
          u.last_name,
          u.name,
          u.email,
          o.title AS opportunity_title,
          o.location AS opportunity_location,
          o.start_date AS opportunity_start_date,
          o.end_date AS opportunity_end_date
 mar FROM ${TABLE} a
        LEFT JOIN users u ON u.user_id = a.user_id
        LEFT JOIN opportunities o ON o.opportunity_id = a.opportunity_id
        ${whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''}
        ORDER BY a.applied_at DESC
    `;
    const [rows] = await pool.execute(sql, params);
    return rows.map(row => {
      row.id = row.application_id;
      row.created_at = row.applied_at;
      return row;
    });
  } catch (error) {
    console.error('[Application] findAll error:', error.message);
    throw error;
  }
}
