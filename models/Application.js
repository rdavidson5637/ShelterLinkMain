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
    const { status, limit } = filters;
    const whereClauses = [];
    const params = [];

    if (status) {
      whereClauses.push('a.status = ?');
      params.push(status);
    }

    const rowLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 100) : null;
    if (rowLimit) params.push(rowLimit);

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
          a.no_show_contacted_at,
          a.no_show_contacted_by,
          a.no_show_followup_sent_at,
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
        ${rowLimit ? 'LIMIT ?' : ''}
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
        a.no_show_contacted_at,
        a.no_show_contacted_by,
        a.no_show_followup_sent_at,
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
  const rows = await findWaitlistedOrdered(opportunityId, 1);
  return rows[0] || null;
}

/** Waitlisted applications oldest-first (for timed seat offers). */
async function findWaitlistedOrdered(opportunityId, limit = 50) {
  try {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 200);
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
        o.title AS opportunity_title,
        vp.quiet_hours_start,
        vp.quiet_hours_end
      FROM ${TABLE} a
      LEFT JOIN users u ON u.user_id = a.user_id
      LEFT JOIN opportunities o ON o.opportunity_id = a.opportunity_id
      LEFT JOIN volunteer_profiles vp ON vp.user_id = a.user_id
      WHERE a.opportunity_id = ?
        AND a.status = 'waitlisted'
      ORDER BY a.applied_at ASC, a.application_id ASC
      LIMIT ?
    `;
    const [rows] = await pool.execute(sql, [opportunityId, safeLimit]);
    return rows.map((row) => {
      row.id = row.application_id;
      row.created_at = row.applied_at;
      return row;
    });
  } catch (error) {
    console.error('[Application] findWaitlistedOrdered error:', error.message);
    throw error;
  }
}

/**
 * Atomically confirm an application if the shift still has a seat (SL-NOW-03).
 * Locks the opportunity row so two instant bookings for the last seat cannot
 * both win. Only moves pending or waitlisted applications.
 * Returns the new status: 'accepted' when a seat was claimed, otherwise
 * fallbackStatus ('waitlisted' or 'pending'), or null if the application is
 * gone or no longer pending/waitlisted.
 */
async function claimSeat(applicationId, opportunityId, fallbackStatus = 'waitlisted') {
  if (!applicationId || !opportunityId) {
    throw new Error('applicationId and opportunityId are required');
  }
  const fallback = fallbackStatus === 'pending' ? 'pending' : 'waitlisted';
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const [oppRows] = await connection.execute(
      `SELECT opportunity_id, max_volunteers
         FROM opportunities
        WHERE opportunity_id = ?
        LIMIT 1
        FOR UPDATE`,
      [opportunityId]
    );
    const opportunity = oppRows[0];
    if (!opportunity) {
      await connection.rollback();
      return null;
    }

    const maxVolunteers = Number(opportunity.max_volunteers);
    let hasSeat = true;
    if (Number.isFinite(maxVolunteers) && maxVolunteers > 0) {
      const [countRows] = await connection.execute(
        `SELECT (
            (SELECT COUNT(*) FROM applications
              WHERE opportunity_id = ? AND status IN ('accepted', 'approved'))
            +
            (SELECT COALESCE(SUM(size), 0) FROM group_bookings
              WHERE opportunity_id = ? AND status = 'confirmed')
          ) AS current_count`,
        [opportunityId, opportunityId]
      );
      hasSeat = Number(countRows[0]?.current_count || 0) < maxVolunteers;
    }

    const nextStatus = hasSeat ? 'accepted' : fallback;
    const [updateResult] = await connection.execute(
      `UPDATE ${TABLE}
          SET status = ?
        WHERE application_id = ?
          AND opportunity_id = ?
          AND status IN ('pending', 'waitlisted')`,
      [nextStatus, applicationId, opportunityId]
    );
    await connection.commit();
    if (!updateResult || !updateResult.affectedRows) return null;
    return nextStatus;
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      /* ignore */
    }
    console.error('[Application] claimSeat error:', error.message);
    throw error;
  } finally {
    connection.release();
  }
}

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
        o.end_date AS opportunity_end_date,
        COALESCE(vp.prefer_reminders, 1) AS prefer_reminders,
        vp.quiet_hours_start,
        vp.quiet_hours_end
      FROM ${TABLE} a
      INNER JOIN opportunities o ON o.opportunity_id = a.opportunity_id
      INNER JOIN users u ON u.user_id = a.user_id
      LEFT JOIN volunteer_profiles vp ON vp.user_id = a.user_id
      WHERE a.status IN ('accepted', 'approved')
        AND a.reminder_sent_at IS NULL
        AND o.start_date IS NOT NULL
        AND o.start_date >= ?
        AND o.start_date < (?::timestamp + interval '24 hours')
        AND (vp.away_until IS NULL OR vp.away_until < CURRENT_DATE)
        AND COALESCE(vp.prefer_reminders, 1) = 1
      ORDER BY o.start_date ASC
    `;
    const nowSql = nowLocalSql(now);
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

/**
 * Recent no-shows for the staff follow-up queue.
 * contacted: 'open' (default) | 'contacted' | 'all'
 * days: how far back by opportunity start date (default 90, max 365)
 */
async function listRecentNoShows({ days = 90, contacted = 'open', limit = 100 } = {}) {
  const dayCount = Number.isFinite(Number(days)) ? Math.min(Math.max(Number(days), 1), 365) : 90;
  const rowLimit = Number.isInteger(limit) && limit > 0 ? Math.min(limit, 200) : 100;
  const where = ['COALESCE(a.no_show, 0) = 1', 'o.start_date >= (CURRENT_TIMESTAMP - (? * INTERVAL \'1 day\'))'];
  const params = [dayCount];

  if (contacted === 'open') {
    where.push('a.no_show_contacted_at IS NULL');
  } else if (contacted === 'contacted') {
    where.push('a.no_show_contacted_at IS NOT NULL');
  }

  params.push(rowLimit);

  const sql = `
    SELECT
      a.application_id,
      a.user_id,
      a.opportunity_id,
      a.status,
      a.applied_at,
      a.no_show,
      a.no_show_contacted_at,
      a.no_show_contacted_by,
      a.no_show_followup_sent_at,
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
    WHERE ${where.join(' AND ')}
    ORDER BY o.start_date DESC, a.application_id DESC
    LIMIT ?
  `;
  const [rows] = await pool.execute(sql, params);
  return rows.map((row) => {
    row.id = row.application_id;
    row.created_at = row.applied_at;
    const first = row.first_name || '';
    const last = row.last_name || '';
    const combined = `${first} ${last}`.trim();
    row.volunteer_name = combined || row.name || null;
    return row;
  });
}

/**
 * Mark a no-show as contacted by staff. Optionally record that a follow-up
 * email was sent on this same action. Idempotent for contacted_at.
 */
async function markNoShowContacted(applicationId, { contactedBy = null, followupSent = false, when = new Date() } = {}) {
  const whenSql = when.toISOString().slice(0, 19).replace('T', ' ');
  const sql = `
    UPDATE ${TABLE}
    SET
      no_show_contacted_at = COALESCE(no_show_contacted_at, ?),
      no_show_contacted_by = COALESCE(no_show_contacted_by, ?),
      no_show_followup_sent_at = CASE
        WHEN ? = 1 THEN COALESCE(no_show_followup_sent_at, ?)
        ELSE no_show_followup_sent_at
      END
    WHERE application_id = ?
      AND COALESCE(no_show, 0) = 1
  `;
  const [result] = await pool.execute(sql, [
    whenSql,
    contactedBy,
    followupSent ? 1 : 0,
    whenSql,
    applicationId,
  ]);
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
  findWaitlistedOrdered,
  claimSeat,
  findAcceptedNeedingReminder,
  markReminderSent,
  markNoShow,
  listRecentNoShows,
  markNoShowContacted,
  countNoShowsByUserId,
  setCheckIn,
  setCheckOut,
  roundHoursToQuarter,
};
