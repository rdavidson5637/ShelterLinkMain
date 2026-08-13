const { pool } = require('../config/database');

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
        FROM ${TABLE} a
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

async function findPending() {
  try {
    const sql = `
        SELECT
          a.application_id,
          a.user_id,
          a.opportunity_id,
          a.status,
          a.applied_at,
          u.name,
          u.email,
          o.title AS opportunity_title,
          o.location AS opportunity_location,
          o.start_date AS opportunity_start_date,
          o.end_date AS opportunity_end_date
        FROM ${TABLE} a
        LEFT JOIN users u ON u.user_id = a.user_id
        LEFT JOIN opportunities o ON o.opportunity_id = a.opportunity_id
        WHERE a.status = 'pending'
        ORDER BY a.applied_at ASC
    `;
    const [rows] = await pool.execute(sql);
    return rows.map(row => {
      row.id = row.application_id;
      row.created_at = row.applied_at;
      return row;
    });
  } catch (error) {
    console.error('[Application] findPending error:', error.message);
    throw error;
  }
}

async function updateStatus(applicationId, status, rejectionReason = null) {
  try {
    if (!applicationId || !status) {
      throw new Error('applicationId and status are required');
    }

    // Store rejection reason if provided
    const sql = rejectionReason
      ? `UPDATE ${TABLE} SET status = ?, rejection_reason = ? WHERE application_id = ?`
      : `UPDATE ${TABLE} SET status = ? WHERE application_id = ?`;

    const params = rejectionReason
      ? [status, rejectionReason, applicationId]
      : [status, applicationId];

    const [updateResult] = await pool.execute(sql, params);
    if (!updateResult.affectedRows) return null;

    const [rows] = await pool.execute(
      `
        SELECT
          a.application_id,
          a.user_id,
          a.opportunity_id,
          a.status,
          a.applied_at,
          a.rejection_reason,
          u.first_name,
          u.last_name,
          u.name,
          u.email,
          o.title AS opportunity_title
        FROM ${TABLE} a
        LEFT JOIN users u ON u.user_id = a.user_id
        LEFT JOIN opportunities o ON o.opportunity_id = a.opportunity_id
        WHERE a.application_id = ?
        LIMIT 1
      `,
      [applicationId]
    );
    const application = rows[0] || null;
    if (application) {
      application.id = application.application_id;
      application.created_at = application.applied_at;
    }
    return application;
  } catch (error) {
    console.error('[Application] updateStatus error:', error.message);
    throw error;
  }
}

async function checkExisting(userId, opportunityId) {
  try {
    const sql = `
      SELECT application_id, status
      FROM ${TABLE}
      WHERE user_id = ? AND opportunity_id = ?
      LIMIT 1
    `;
    const [rows] = await pool.execute(sql, [userId, opportunityId]);
    return rows[0] || null;
  } catch (error) {
    console.error('[Application] checkExisting error:', error.message);
    throw error;
  }
}

async function findById(applicationId) {
  try {
    const sql = `
      SELECT
        a.application_id,
        a.user_id,
        a.opportunity_id,
        a.status,
        a.applied_at,
        a.rejection_reason,
        a.reminder_sent_at,
        a.no_show,
        a.checked_in_at,
        a.checked_out_at,
        u.name,
        u.email,
        o.title AS opportunity_title,
        o.location AS opportunity_location,
        o.start_date AS opportunity_start_date,
        o.end_date AS opportunity_end_date,
        o.check_in_code,
        o.cancellation_cutoff_hours
      FROM ${TABLE} a
      LEFT JOIN users u ON u.user_id = a.user_id
      LEFT JOIN opportunities o ON o.opportunity_id = a.opportunity_id
      WHERE a.application_id = ?
      LIMIT 1
    `;
    const [rows] = await pool.execute(sql, [applicationId]);
    const row = rows[0] || null;
    if (row) {
      row.id = row.application_id;
      row.created_at = row.applied_at;
    }
    return row;
  } catch (error) {
    console.error('[Application] findById error:', error.message);
    throw error;
  }
}

async function countApprovedByUserId(userId) {
  try {
    if (!userId) {
      throw new Error('userId is required');
    }
    const sql = `
      SELECT COUNT(*) AS cnt
      FROM ${TABLE}
      WHERE user_id = ?
        AND status IN ('accepted', 'approved')
    `;
    const [rows] = await pool.execute(sql, [userId]);
    return rows[0]?.cnt ?? 0;
  } catch (error) {
    console.error('[Application] countApprovedByUserId error:', error.message);
    throw error;
  }
}

async function cancelApplication(applicationId, userId, { asAdmin = false } = {}) {
  try {
    const app = await findById(applicationId);
    if (!app) return null;

    if (!asAdmin && Number(app.user_id) !== Number(userId)) {
      return { forbidden: true };
    }

    const validStatuses = ['pending', 'accepted', 'approved', 'waitlisted'];
    if (!validStatuses.includes(app.status)) {
      return { invalidStatus: true };
    }

    let sql;
    let params;
    if (asAdmin) {
      sql = `DELETE FROM ${TABLE} WHERE application_id = ?`;
      params = [applicationId];
    } else {
      sql = `DELETE FROM ${TABLE} WHERE application_id = ? AND user_id = ?`;
      params = [applicationId, userId];
    }
    const [result] = await pool.execute(sql, params);
    if (!result.affectedRows) return null;

    return { ...app, prior_status: app.status, status: 'cancelled' };
  } catch (error) {
    console.error('[Application] cancelApplication error:', error.message);
    throw error;
  }
}

async function findOldestWaitlisted(opportunityId) {
  try {
    const sql = `
      SELECT
        a.application_id,
        a.user_id,
        a.opportunity_id,
        a.status,
        a.applied_at,
        u.email,
        u.first_name,
        u.last_name,
        u.name,
        o.title AS opportunity_title
      FROM ${TABLE} a
      LEFT JOIN users u ON u.user_id = a.user_id
      LEFT JOIN opportunities o ON o.opportunity_id = a.opportunity_id
      WHERE a.opportunity_id = ?
        AND a.status = 'waitlisted'
      ORDER BY a.applied_at ASC, a.application_id ASC
      LIMIT 1
    `;
    const [rows] = await pool.execute(sql, [opportunityId]);
    const row = rows[0] || null;
    if (row) {
      row.id = row.application_id;
      row.created_at = row.applied_at;
    }
    return row;
  } catch (error) {
    console.error('[Application] findOldestWaitlisted error:', error.message);
    throw error;
  }
}

/**
 * Accepted applications for opportunities starting within the next 24 hours
 * that have not yet been sent a reminder.
 */
async function findAcceptedNeedingReminder(now = new Date()) {
  try {
    const sql = `
      SELECT
        a.application_id,
        a.user_id,
        a.opportunity_id,
        a.status,
        a.reminder_sent_at,
        u.email,
        u.first_name,
        u.last_name,
        o.title AS opportunity_title,
        o.location AS opportunity_location,
        o.start_date AS opportunity_start_date,
        o.end_date AS opportunity_end_date
      FROM ${TABLE} a
      INNER JOIN opportunities o ON o.opportunity_id = a.opportunity_id
      INNER JOIN users u ON u.user_id = a.user_id
      WHERE a.status IN ('accepted', 'approved')
        AND a.reminder_sent_at IS NULL
        AND o.start_date IS NOT NULL
        AND o.start_date >= ?
        AND o.start_date < DATE_ADD(?, INTERVAL 24 HOUR)
      ORDER BY o.start_date ASC
    `;
    const nowSql = now.toISOString().slice(0, 19).replace('T', ' ');
    const [rows] = await pool.execute(sql, [nowSql, nowSql]);
    return rows.map((row) => {
      row.id = row.application_id;
      return row;
    });
  } catch (error) {
    console.error('[Application] findAcceptedNeedingReminder error:', error.message);
    throw error;
  }
}

async function markReminderSent(applicationId, when = new Date()) {
  const sql = `
    UPDATE ${TABLE}
    SET reminder_sent_at = ?
    WHERE application_id = ?
      AND reminder_sent_at IS NULL
  `;
  const whenSql = when.toISOString().slice(0, 19).replace('T', ' ');
  const [result] = await pool.execute(sql, [whenSql, applicationId]);
  return result.affectedRows > 0;
}

async function markNoShow(applicationId, noShow = true) {
  const sql = `
    UPDATE ${TABLE}
    SET no_show = ?
    WHERE application_id = ?
  `;
  const [result] = await pool.execute(sql, [noShow ? 1 : 0, applicationId]);
  if (!result.affectedRows) return null;
  return findById(applicationId);
}

async function countNoShowsByUserId(userId) {
  const sql = `
    SELECT COUNT(*) AS cnt
    FROM ${TABLE}
    WHERE user_id = ?
      AND no_show = 1
  `;
  const [rows] = await pool.execute(sql, [userId]);
  return Number(rows[0]?.cnt || 0);
}

async function setCheckIn(applicationId, when = new Date()) {
  const sql = `
    UPDATE ${TABLE}
    SET checked_in_at = ?
    WHERE application_id = ?
      AND checked_in_at IS NULL
  `;
  const whenSql = when.toISOString().slice(0, 19).replace('T', ' ');
  const [result] = await pool.execute(sql, [whenSql, applicationId]);
  if (!result.affectedRows) return null;
  return findById(applicationId);
}

async function setCheckOut(applicationId, when = new Date()) {
  const sql = `
    UPDATE ${TABLE}
    SET checked_out_at = ?
    WHERE application_id = ?
      AND checked_in_at IS NOT NULL
      AND checked_out_at IS NULL
  `;
  const whenSql = when.toISOString().slice(0, 19).replace('T', ' ');
  const [result] = await pool.execute(sql, [whenSql, applicationId]);
  if (!result.affectedRows) return null;
  return findById(applicationId);
}

/**
 * Round a duration in hours to the nearest 15 minutes (0.25h).
 */
function roundHoursToQuarter(hours) {
  return Math.round(Number(hours) * 4) / 4;
}

module.exports = {
  create,
  findByUserId,
  findByOpportunityId,
  findAll,
  findPending,
  findById,
  updateStatus,
  checkExisting,
  countApprovedByUserId,
  cancelApplication,
  findOldestWaitlisted,
  findAcceptedNeedingReminder,
  markReminderSent,
  markNoShow,
  countNoShowsByUserId,
  setCheckIn,
  setCheckOut,
  roundHoursToQuarter,
};
