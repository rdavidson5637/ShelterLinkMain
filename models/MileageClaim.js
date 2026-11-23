'use strict';

const { pool } = require('../config/database');

const STATUSES = Object.freeze(['pending', 'approved', 'rejected']);
const MAX_MILES = 2000;

function mapClaim(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    user_id: Number(row.user_id),
    travel_date: row.travel_date ? String(row.travel_date).slice(0, 10) : null,
    miles: Number(row.miles),
    purpose: row.purpose,
    transport_leg_id: row.transport_leg_id != null ? Number(row.transport_leg_id) : null,
    opportunity_id: row.opportunity_id != null ? Number(row.opportunity_id) : null,
    status: row.status,
    reviewed_by: row.reviewed_by != null ? Number(row.reviewed_by) : null,
    reviewed_at: row.reviewed_at || null,
    created_at: row.created_at || null,
    first_name: row.first_name || null,
    last_name: row.last_name || null,
    email: row.email || null,
    opportunity_title: row.opportunity_title || null,
    run_title: row.run_title || null,
    from_location: row.from_location || null,
    to_location: row.to_location || null,
  };
}

const SELECT_JOIN = `
  SELECT
    mc.id,
    mc.user_id,
    mc.travel_date,
    mc.miles,
    mc.purpose,
    mc.transport_leg_id,
    mc.opportunity_id,
    mc.status,
    mc.reviewed_by,
    mc.reviewed_at,
    mc.created_at,
    u.first_name,
    u.last_name,
    u.email,
    o.title AS opportunity_title,
    tr.title AS run_title,
    tl.from_location,
    tl.to_location
  FROM mileage_claims mc
  INNER JOIN users u ON u.user_id = mc.user_id
  LEFT JOIN opportunities o ON o.opportunity_id = mc.opportunity_id
  LEFT JOIN transport_legs tl ON tl.id = mc.transport_leg_id
  LEFT JOIN transport_runs tr ON tr.id = tl.run_id
`;

async function findById(id) {
  const [rows] = await pool.execute(`${SELECT_JOIN} WHERE mc.id = ? LIMIT 1`, [Number(id)]);
  return mapClaim(rows[0]);
}

async function findByUserId(userId) {
  const [rows] = await pool.execute(
    `${SELECT_JOIN} WHERE mc.user_id = ? ORDER BY mc.travel_date DESC, mc.id DESC`,
    [Number(userId)]
  );
  return rows.map(mapClaim);
}

async function findByStatus(status = 'pending') {
  const [rows] = await pool.execute(
    `${SELECT_JOIN} WHERE mc.status = ? ORDER BY mc.travel_date ASC, mc.id ASC`,
    [status]
  );
  return rows.map(mapClaim);
}

async function findForTransportLeg(legId) {
  const [rows] = await pool.execute(
    `${SELECT_JOIN} WHERE mc.transport_leg_id = ? LIMIT 1`,
    [Number(legId)]
  );
  return mapClaim(rows[0]);
}

function normaliseMiles(value) {
  const miles = Number(value);
  if (!Number.isFinite(miles) || miles <= 0 || miles > MAX_MILES) {
    const err = new Error(`Miles must be greater than 0 and at most ${MAX_MILES}`);
    err.status = 400;
    throw err;
  }
  return Math.round(miles * 100) / 100;
}

function normalisePurpose(value) {
  const purpose = String(value || '').trim();
  if (!purpose || purpose.length > 500) {
    const err = new Error('Purpose is required (max 500 characters)');
    err.status = 400;
    throw err;
  }
  return purpose;
}

function normaliseDate(value) {
  const raw = String(value || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const err = new Error('travel_date must be YYYY-MM-DD');
    err.status = 400;
    throw err;
  }
  const when = new Date(`${raw}T12:00:00Z`);
  const today = new Date();
  today.setUTCHours(23, 59, 59, 999);
  if (Number.isNaN(when.getTime()) || when > today) {
    const err = new Error('Cannot claim mileage for a future date');
    err.status = 400;
    throw err;
  }
  return raw;
}

/**
 * Create a freeform travel claim (optional opportunity link).
 */
async function create({ userId, travelDate, miles, purpose, opportunityId = null }) {
  const date = normaliseDate(travelDate);
  const milesValue = normaliseMiles(miles);
  const purposeValue = normalisePurpose(purpose);
  const oppId = opportunityId != null && opportunityId !== '' ? Number(opportunityId) : null;

  const [result] = await pool.execute(
    `INSERT INTO mileage_claims
       (user_id, travel_date, miles, purpose, opportunity_id, status)
     VALUES (?, ?, ?, ?, ?, 'pending')`,
    [Number(userId), date, milesValue, purposeValue, oppId]
  );
  return findById(result.insertId);
}

/**
 * Claim mileage for a completed transport leg the volunteer drove.
 * Uses the leg's distance when miles are omitted.
 */
async function createFromTransportLeg({ userId, legId, miles = null, purpose = null }) {
  const [legs] = await pool.execute(
    `
      SELECT
        tl.id,
        tl.claimed_by,
        tl.completed_at,
        tl.distance_miles,
        tl.from_location,
        tl.to_location,
        tr.title AS run_title,
        tr.run_date
      FROM transport_legs tl
      INNER JOIN transport_runs tr ON tr.id = tl.run_id
      WHERE tl.id = ?
      LIMIT 1
    `,
    [Number(legId)]
  );
  const leg = legs[0];
  if (!leg) {
    const err = new Error('Transport leg not found');
    err.status = 404;
    throw err;
  }
  if (Number(leg.claimed_by) !== Number(userId)) {
    const err = new Error('You can only claim mileage for legs you completed');
    err.status = 403;
    throw err;
  }
  if (!leg.completed_at) {
    const err = new Error('Complete the leg before claiming mileage');
    err.status = 400;
    throw err;
  }

  const existing = await findForTransportLeg(leg.id);
  if (existing) {
    const err = new Error('Mileage has already been claimed for this leg');
    err.status = 409;
    throw err;
  }

  const milesSource = miles != null && miles !== '' ? miles : leg.distance_miles;
  if (milesSource == null || milesSource === '') {
    const err = new Error('Miles are required when the leg has no recorded distance');
    err.status = 400;
    throw err;
  }

  const purposeValue =
    purpose && String(purpose).trim()
      ? normalisePurpose(purpose)
      : normalisePurpose(
          `${leg.run_title || 'Transport'}: ${leg.from_location} → ${leg.to_location}`
        );

  const travelDate = leg.run_date
    ? String(leg.run_date).slice(0, 10)
    : String(leg.completed_at).slice(0, 10);

  try {
    const [result] = await pool.execute(
      `INSERT INTO mileage_claims
         (user_id, travel_date, miles, purpose, transport_leg_id, status)
       VALUES (?, ?, ?, ?, ?, 'pending')`,
      [Number(userId), normaliseDate(travelDate), normaliseMiles(milesSource), purposeValue, Number(leg.id)]
    );
    return findById(result.insertId);
  } catch (error) {
    if (error && (error.code === '23505' || /unique/i.test(String(error.message)))) {
      const err = new Error('Mileage has already been claimed for this leg');
      err.status = 409;
      throw err;
    }
    throw error;
  }
}

async function setStatus(id, status, reviewerId) {
  if (!STATUSES.includes(status) || status === 'pending') {
    const err = new Error('status must be approved or rejected');
    err.status = 400;
    throw err;
  }
  const claim = await findById(id);
  if (!claim) return null;
  if (claim.status !== 'pending') {
    const err = new Error(`Claim is already ${claim.status}`);
    err.status = 400;
    throw err;
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [result] = await conn.execute(
      `UPDATE mileage_claims
       SET status = ?, reviewed_by = ?, reviewed_at = CURRENT_TIMESTAMP
       WHERE id = ? AND status = 'pending'`,
      [status, Number(reviewerId), Number(id)]
    );
    if (!result.affectedRows) {
      await conn.rollback();
      const err = new Error('Claim is already reviewed');
      err.status = 400;
      throw err;
    }

    if (status === 'approved' && claim.transport_leg_id) {
      await conn.execute(
        `UPDATE transport_legs SET expense_claimed = 1 WHERE id = ?`,
        [claim.transport_leg_id]
      );
    }

    await conn.commit();
  } catch (error) {
    try {
      await conn.rollback();
    } catch (_) {
      /* ignore */
    }
    throw error;
  } finally {
    conn.release();
  }

  return findById(id);
}

async function approvedTotalsByVolunteer() {
  const [rows] = await pool.execute(
    `
      SELECT
        mc.user_id,
        u.first_name,
        u.last_name,
        u.email,
        SUM(mc.miles)::float AS total_miles,
        COUNT(*)::int AS claim_count
      FROM mileage_claims mc
      INNER JOIN users u ON u.user_id = mc.user_id
      WHERE mc.status = 'approved'
      GROUP BY mc.user_id, u.first_name, u.last_name, u.email
      ORDER BY total_miles DESC
    `
  );
  return rows.map((r) => ({
    user_id: Number(r.user_id),
    first_name: r.first_name,
    last_name: r.last_name,
    email: r.email,
    total_miles: Number(r.total_miles) || 0,
    claim_count: Number(r.claim_count) || 0,
  }));
}

module.exports = {
  STATUSES,
  MAX_MILES,
  mapClaim,
  findById,
  findByUserId,
  findByStatus,
  findForTransportLeg,
  create,
  createFromTransportLeg,
  setStatus,
  approvedTotalsByVolunteer,
};
