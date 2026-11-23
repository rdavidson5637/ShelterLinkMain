'use strict';

/**
 * Timed waitlist seat offers (SL-LATER-23).
 * One active offer per opportunity. Claim window starts when the volunteer is
 * notified (so quiet hours do not burn the deadline).
 */

const crypto = require('crypto');
const { pool } = require('../config/database');

const TABLE = 'waitlist_offers';
const OFFER_HOURS = 12;

function toSqlDateTime(date = new Date()) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

function addHours(date, hours) {
  return new Date(date.getTime() + Number(hours) * 60 * 60 * 1000);
}

function generateClaimToken() {
  return crypto.randomBytes(24).toString('hex');
}

function mapRow(row) {
  if (!row) return null;
  row.offer_id = row.id;
  return row;
}

async function findById(offerId) {
  const [rows] = await pool.execute(`SELECT * FROM ${TABLE} WHERE id = ? LIMIT 1`, [offerId]);
  return mapRow(rows[0] || null);
}

async function findActiveForOpportunity(opportunityId) {
  const [rows] = await pool.execute(
    `
      SELECT *
      FROM ${TABLE}
      WHERE opportunity_id = ?
        AND status = 'offered'
      ORDER BY id DESC
      LIMIT 1
    `,
    [opportunityId]
  );
  return mapRow(rows[0] || null);
}

async function findByClaimToken(token) {
  if (!token) return null;
  const [rows] = await pool.execute(
    `
      SELECT
        w.*,
        o.title AS opportunity_title,
        o.location AS opportunity_location,
        o.start_date AS opportunity_start_date,
        o.end_date AS opportunity_end_date,
        o.max_volunteers,
        o.status AS opportunity_status,
        a.status AS application_status
      FROM ${TABLE} w
      INNER JOIN opportunities o ON o.opportunity_id = w.opportunity_id
      INNER JOIN applications a ON a.application_id = w.application_id
      WHERE w.claim_token = ?
        AND w.status = 'offered'
      LIMIT 1
    `,
    [String(token)]
  );
  return mapRow(rows[0] || null);
}

async function create({ opportunityId, applicationId, userId }) {
  const token = generateClaimToken();
  const [result] = await pool.execute(
    `
      INSERT INTO ${TABLE}
        (opportunity_id, application_id, user_id, claim_token, status, offered_at)
      VALUES (?, ?, ?, ?, 'offered', NOW())
    `,
    [opportunityId, applicationId, userId, token]
  );
  return findById(result.insertId);
}

/**
 * Mark an offer notified and start the claim clock.
 * No-op when already notified.
 */
async function markNotified(offerId, now = new Date(), hours = OFFER_HOURS) {
  const expiresAt = addHours(now, hours);
  const [result] = await pool.execute(
    `
      UPDATE ${TABLE}
         SET notified_at = ?,
             expires_at = ?
       WHERE id = ?
         AND status = 'offered'
         AND notified_at IS NULL
    `,
    [toSqlDateTime(now), toSqlDateTime(expiresAt), offerId]
  );
  if (!result.affectedRows) return findById(offerId);
  return findById(offerId);
}

async function markClaimed(offerId, now = new Date()) {
  const [result] = await pool.execute(
    `
      UPDATE ${TABLE}
         SET status = 'claimed',
             claimed_at = ?
       WHERE id = ?
         AND status = 'offered'
    `,
    [toSqlDateTime(now), offerId]
  );
  if (!result.affectedRows) return null;
  return findById(offerId);
}

async function markExpired(offerId) {
  const [result] = await pool.execute(
    `
      UPDATE ${TABLE}
         SET status = 'expired'
       WHERE id = ?
         AND status = 'offered'
    `,
    [offerId]
  );
  return result.affectedRows > 0;
}

async function cancelForOpportunity(opportunityId) {
  const [result] = await pool.execute(
    `
      UPDATE ${TABLE}
         SET status = 'cancelled'
       WHERE opportunity_id = ?
         AND status = 'offered'
    `,
    [opportunityId]
  );
  return result.affectedRows;
}

/** Offers waiting to be emailed/pushed (quiet hours may have delayed them). */
async function findAwaitingNotify() {
  const [rows] = await pool.execute(
    `
      SELECT
        w.*,
        u.email,
        u.first_name,
        u.last_name,
        o.title AS opportunity_title,
        o.location AS opportunity_location,
        o.start_date AS opportunity_start_date,
        vp.quiet_hours_start,
        vp.quiet_hours_end
      FROM ${TABLE} w
      INNER JOIN users u ON u.user_id = w.user_id
      INNER JOIN opportunities o ON o.opportunity_id = w.opportunity_id
      LEFT JOIN volunteer_profiles vp ON vp.user_id = w.user_id
      INNER JOIN applications a ON a.application_id = w.application_id
      WHERE w.status = 'offered'
        AND w.notified_at IS NULL
        AND a.status = 'waitlisted'
      ORDER BY w.id ASC
    `
  );
  return rows.map(mapRow);
}

/** Notified offers whose claim window has passed. */
async function findExpiredOffers(now = new Date()) {
  const [rows] = await pool.execute(
    `
      SELECT w.*
      FROM ${TABLE} w
      WHERE w.status = 'offered'
        AND w.expires_at IS NOT NULL
        AND w.expires_at <= ?
      ORDER BY w.expires_at ASC, w.id ASC
    `,
    [toSqlDateTime(now)]
  );
  return rows.map(mapRow);
}

/**
 * Opportunities with free seats and waitlisted volunteers but no active offer.
 * Used by the hourly job as a catch-up when a seat freed while the app was down.
 */
async function findOpportunitiesNeedingOffer() {
  const [rows] = await pool.execute(
    `
      SELECT o.opportunity_id, o.max_volunteers, o.status, o.title
      FROM opportunities o
      WHERE o.status IN ('open', 'closed')
        AND o.max_volunteers IS NOT NULL
        AND o.max_volunteers > 0
        AND (
          (SELECT COUNT(*) FROM applications a
            WHERE a.opportunity_id = o.opportunity_id
              AND a.status IN ('accepted', 'approved'))
          +
          (SELECT COALESCE(SUM(size), 0) FROM group_bookings g
            WHERE g.opportunity_id = o.opportunity_id
              AND g.status = 'confirmed')
        ) < o.max_volunteers
        AND EXISTS (
          SELECT 1 FROM applications a
          WHERE a.opportunity_id = o.opportunity_id
            AND a.status = 'waitlisted'
        )
        AND NOT EXISTS (
          SELECT 1 FROM ${TABLE} w
          WHERE w.opportunity_id = o.opportunity_id
            AND w.status = 'offered'
        )
      ORDER BY o.opportunity_id ASC
      LIMIT 100
    `
  );
  return rows;
}

module.exports = {
  TABLE,
  OFFER_HOURS,
  generateClaimToken,
  addHours,
  findById,
  findActiveForOpportunity,
  findByClaimToken,
  create,
  markNotified,
  markClaimed,
  markExpired,
  cancelForOpportunity,
  findAwaitingNotify,
  findExpiredOffers,
  findOpportunitiesNeedingOffer,
};
