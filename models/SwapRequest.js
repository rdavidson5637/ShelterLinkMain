'use strict';

const crypto = require('crypto');
const { pool } = require('../config/database');

const TABLE = 'swap_requests';
const WAITLIST_OFFER_HOURS = 12;

function mapRow(row) {
  if (!row) return null;
  row.swap_id = row.id;
  return row;
}

function toSqlDateTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function addHours(date, hours) {
  return new Date(date.getTime() + Number(hours) * 60 * 60 * 1000);
}

async function findById(swapId) {
  const sql = `
    SELECT
      s.*,
      a.user_id AS original_user_id,
      a.opportunity_id,
      a.status AS application_status,
      o.title AS opportunity_title,
      o.location AS opportunity_location,
      o.start_date AS opportunity_start_date,
      o.end_date AS opportunity_end_date,
      o.cancellation_cutoff_hours
    FROM ${TABLE} s
    INNER JOIN applications a ON a.application_id = s.application_id
    INNER JOIN opportunities o ON o.opportunity_id = a.opportunity_id
    WHERE s.id = ?
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [swapId]);
  return mapRow(rows[0] || null);
}

async function findOpenByApplicationId(applicationId) {
  const sql = `
    SELECT *
    FROM ${TABLE}
    WHERE application_id = ?
      AND status = 'open'
    ORDER BY requested_at DESC
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [applicationId]);
  return mapRow(rows[0] || null);
}

async function findByClaimToken(token) {
  if (!token) return null;
  const sql = `
    SELECT
      s.*,
      a.user_id AS original_user_id,
      a.opportunity_id,
      a.status AS application_status,
      o.title AS opportunity_title,
      o.location AS opportunity_location,
      o.start_date AS opportunity_start_date,
      o.end_date AS opportunity_end_date
    FROM ${TABLE} s
    INNER JOIN applications a ON a.application_id = s.application_id
    INNER JOIN opportunities o ON o.opportunity_id = a.opportunity_id
    WHERE s.claim_token = ?
      AND s.status = 'open'
    LIMIT 1
  `;
  const [rows] = await pool.execute(sql, [token]);
  return mapRow(rows[0] || null);
}

/**
 * Public open swaps (waitlist exclusive window ended or never applied).
 */
async function findOpenPublic(now = new Date()) {
  const nowSql = toSqlDateTime(now);
  const sql = `
    SELECT
      s.id,
      s.application_id,
      s.requested_at,
      s.status,
      s.public_at,
      a.user_id AS original_user_id,
      a.opportunity_id,
      o.title AS opportunity_title,
      o.description AS opportunity_description,
      o.location AS opportunity_location,
      o.start_date AS opportunity_start_date,
      o.end_date AS opportunity_end_date,
      o.max_volunteers,
      (
        (
          SELECT COUNT(*)
          FROM applications acc
          WHERE acc.opportunity_id = a.opportunity_id
            AND acc.status IN ('accepted', 'approved')
        )
        +
        (
          SELECT COALESCE(SUM(gb.size), 0)
          FROM group_bookings gb
          WHERE gb.opportunity_id = a.opportunity_id
            AND gb.status = 'confirmed'
        )
      ) AS spots_filled
    FROM ${TABLE} s
    INNER JOIN applications a ON a.application_id = s.application_id
    INNER JOIN opportunities o ON o.opportunity_id = a.opportunity_id
    WHERE s.status = 'open'
      AND s.public_at IS NOT NULL
      AND s.public_at <= ?
      AND a.status IN ('accepted', 'approved')
    ORDER BY o.start_date ASC, s.requested_at ASC
  `;
  const [rows] = await pool.execute(sql, [nowSql]);
  return rows.map(mapRow);
}

async function create(applicationId, options = {}) {
  const {
    waitlistOfferedToUserId = null,
    waitlistOfferExpiresAt = null,
    claimToken = null,
    publicAt = null,
    requestedAt = new Date(),
  } = options;

  const sql = `
    INSERT INTO ${TABLE}
      (application_id, requested_at, status, waitlist_offered_to_user_id,
       waitlist_offer_expires_at, claim_token, public_at)
    VALUES (?, ?, 'open', ?, ?, ?, ?)
  `;
  const [result] = await pool.execute(sql, [
    applicationId,
    toSqlDateTime(requestedAt),
    waitlistOfferedToUserId,
    waitlistOfferExpiresAt ? toSqlDateTime(waitlistOfferExpiresAt) : null,
    claimToken,
    publicAt ? toSqlDateTime(publicAt) : null,
  ]);
  return findById(result.insertId);
}

async function cancelOpenForApplication(applicationId) {
  const sql = `
    UPDATE ${TABLE}
    SET status = 'cancelled'
    WHERE application_id = ?
      AND status = 'open'
  `;
  const [result] = await pool.execute(sql, [applicationId]);
  return result.affectedRows;
}

async function cancelById(swapId, applicationOwnerUserId) {
  const swap = await findById(swapId);
  if (!swap) return null;
  if (Number(swap.original_user_id) !== Number(applicationOwnerUserId)) {
    return { forbidden: true };
  }
  if (swap.status !== 'open') {
    return { invalidStatus: true };
  }
  const [result] = await pool.execute(
    `UPDATE ${TABLE} SET status = 'cancelled' WHERE id = ? AND status = 'open'`,
    [swapId]
  );
  if (!result.affectedRows) return { invalidStatus: true };
  return findById(swapId);
}

/**
 * Promote waitlist-exclusive swaps to public after the offer window.
 */
async function publishExpiredWaitlistOffers(now = new Date()) {
  const nowSql = toSqlDateTime(now);
  const sql = `
    UPDATE ${TABLE}
    SET public_at = ?
    WHERE status = 'open'
      AND public_at IS NULL
      AND waitlist_offer_expires_at IS NOT NULL
      AND waitlist_offer_expires_at <= ?
  `;
  const [result] = await pool.execute(sql, [nowSql, nowSql]);
  return result.affectedRows;
}

/**
 * Atomically transfer an accepted slot from the original volunteer to the claimer.
 * Returns { swap, original, claimerApplication } or throws with .code for controller mapping.
 */
async function claimAtomically(swapId, claimerUserId, { viaToken = null, now = new Date() } = {}) {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();

    const [swapRows] = await connection.execute(
      `
        SELECT
          s.*,
          a.user_id AS original_user_id,
          a.opportunity_id,
          a.status AS application_status,
          o.title AS opportunity_title
        FROM ${TABLE} s
        INNER JOIN applications a ON a.application_id = s.application_id
        INNER JOIN opportunities o ON o.opportunity_id = a.opportunity_id
        WHERE s.id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [swapId]
    );
    const swap = swapRows[0];
    if (!swap) {
      const err = new Error('Swap not found');
      err.code = 'NOT_FOUND';
      throw err;
    }
    if (swap.status !== 'open') {
      const err = new Error('Swap is no longer open');
      err.code = 'NOT_OPEN';
      throw err;
    }
    if (!['accepted', 'approved'].includes(swap.application_status)) {
      const err = new Error('Original application is no longer accepted');
      err.code = 'NOT_OPEN';
      throw err;
    }
    if (Number(swap.original_user_id) === Number(claimerUserId)) {
      const err = new Error('You cannot claim your own swap');
      err.code = 'OWN_SWAP';
      throw err;
    }

    const nowSql = toSqlDateTime(now);
    const isWaitlistClaim =
      viaToken &&
      swap.claim_token &&
      viaToken === swap.claim_token &&
      Number(swap.waitlist_offered_to_user_id) === Number(claimerUserId) &&
      swap.waitlist_offer_expires_at &&
      new Date(swap.waitlist_offer_expires_at) >= now;

    const isPublic =
      swap.public_at != null && new Date(swap.public_at) <= now;

    if (!isWaitlistClaim && !isPublic) {
      const err = new Error('This swap is not yet available to claim');
      err.code = 'NOT_PUBLIC';
      throw err;
    }

    if (viaToken && !isWaitlistClaim) {
      const err = new Error('Invalid or expired claim link');
      err.code = 'BAD_TOKEN';
      throw err;
    }

    // Existing application for claimer on this opportunity (if any)
    const [existingRows] = await connection.execute(
      `
        SELECT application_id, status
        FROM applications
        WHERE user_id = ? AND opportunity_id = ?
        LIMIT 1
        FOR UPDATE
      `,
      [claimerUserId, swap.opportunity_id]
    );
    const existing = existingRows[0] || null;
    if (existing && ['accepted', 'approved'].includes(existing.status)) {
      const err = new Error('You already have an accepted place on this shift');
      err.code = 'ALREADY_ACCEPTED';
      throw err;
    }

    // Cancel original accepted application (keep row for history / unique key)
    const [cancelResult] = await connection.execute(
      `
        UPDATE applications
        SET status = 'cancelled'
        WHERE application_id = ?
          AND status IN ('accepted', 'approved')
      `,
      [swap.application_id]
    );
    if (!cancelResult.affectedRows) {
      const err = new Error('Could not release original slot');
      err.code = 'RACE';
      throw err;
    }

    let claimerApplicationId;
    if (existing) {
      await connection.execute(
        `
          UPDATE applications
          SET status = 'accepted', rejection_reason = NULL
          WHERE application_id = ?
        `,
        [existing.application_id]
      );
      claimerApplicationId = existing.application_id;
    } else {
      const [insertResult] = await connection.execute(
        `
          INSERT INTO applications (user_id, opportunity_id, status)
          VALUES (?, ?, 'accepted')
        `,
        [claimerUserId, swap.opportunity_id]
      );
      claimerApplicationId = insertResult.insertId;
    }

    const [claimSwapResult] = await connection.execute(
      `
        UPDATE ${TABLE}
        SET status = 'claimed',
            claimed_by_application_id = ?
        WHERE id = ?
          AND status = 'open'
      `,
      [claimerApplicationId, swapId]
    );
    if (!claimSwapResult.affectedRows) {
      const err = new Error('Swap was claimed by someone else');
      err.code = 'RACE';
      throw err;
    }

    await connection.commit();

    const [claimerRows] = await pool.execute(
      `
        SELECT a.*, u.email, u.first_name, u.last_name, u.name
        FROM applications a
        LEFT JOIN users u ON u.user_id = a.user_id
        WHERE a.application_id = ?
        LIMIT 1
      `,
      [claimerApplicationId]
    );
    const [originalRows] = await pool.execute(
      `
        SELECT a.*, u.email, u.first_name, u.last_name, u.name
        FROM applications a
        LEFT JOIN users u ON u.user_id = a.user_id
        WHERE a.application_id = ?
        LIMIT 1
      `,
      [swap.application_id]
    );

    const claimerApplication = claimerRows[0] || null;
    if (claimerApplication) {
      claimerApplication.id = claimerApplication.application_id;
    }
    const original = originalRows[0] || null;
    if (original) {
      original.id = original.application_id;
    }

    return {
      swap: await findById(swapId),
      original,
      claimerApplication,
      opportunityId: swap.opportunity_id,
      opportunityTitle: swap.opportunity_title,
    };
  } catch (error) {
    try {
      await connection.rollback();
    } catch {
      // ignore rollback errors
    }
    throw error;
  } finally {
    connection.release();
  }
}

function generateClaimToken() {
  return crypto.randomBytes(24).toString('hex');
}

module.exports = {
  WAITLIST_OFFER_HOURS,
  findById,
  findOpenByApplicationId,
  findByClaimToken,
  findOpenPublic,
  create,
  cancelOpenForApplication,
  cancelById,
  publishExpiredWaitlistOffers,
  claimAtomically,
  generateClaimToken,
  addHours,
  toSqlDateTime,
};
