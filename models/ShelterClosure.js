'use strict';

/**
 * Shelter closure dates (SL-LATER-30). See database/058_shelter_closures.pg.sql.
 * Every query names shelter_id from the request context. Row level security
 * is the second guard.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');
const { normaliseClosure, normaliseClosures, dayOf } = require('../utils/closureDates');
const { todayIso } = require('../utils/shelterTime');

function requireShelterId() {
  const shelterId = currentShelterId();
  if (!shelterId) {
    const err = new Error('Shelter context is missing');
    err.status = 403;
    throw err;
  }
  return shelterId;
}

/** All closures, newest range first. includePast=false keeps today onward. */
async function list({ includePast = false } = {}) {
  const shelterId = currentShelterId();
  if (!shelterId) return [];
  const params = [shelterId];
  let where = 'shelter_id = ?';
  if (!includePast) {
    where += ' AND ends_on >= ?';
    params.push(todayIso());
  }
  const [rows] = await pool.execute(
    `SELECT id, starts_on, ends_on, reason, created_at
       FROM shelter_closures
      WHERE ${where}
      ORDER BY starts_on ASC, id ASC
      LIMIT 500`,
    params
  );
  return normaliseClosures(rows);
}

/** Closures that overlap [from, to] (inclusive days). */
async function findOverlapping(from, to) {
  const shelterId = currentShelterId();
  const fromDay = dayOf(from);
  const toDay = dayOf(to) || fromDay;
  if (!shelterId || !fromDay) return [];
  const [rows] = await pool.execute(
    `SELECT id, starts_on, ends_on, reason, created_at
       FROM shelter_closures
      WHERE shelter_id = ? AND starts_on <= ? AND ends_on >= ?
      ORDER BY starts_on ASC, id ASC
      LIMIT 500`,
    [shelterId, toDay, fromDay]
  );
  return normaliseClosures(rows);
}

async function findById(id) {
  const shelterId = currentShelterId();
  if (!shelterId || !id) return null;
  const [rows] = await pool.execute(
    `SELECT id, starts_on, ends_on, reason, created_at
       FROM shelter_closures
      WHERE shelter_id = ? AND id = ?
      LIMIT 1`,
    [shelterId, id]
  );
  return normaliseClosure(rows[0]);
}

async function create({ starts_on: startsOn, ends_on: endsOn, reason }, createdBy) {
  const shelterId = requireShelterId();
  const [rows] = await pool.execute(
    `INSERT INTO shelter_closures (shelter_id, starts_on, ends_on, reason, created_by)
     VALUES (?, ?, ?, ?, ?)
     RETURNING id, starts_on, ends_on, reason, created_at`,
    [shelterId, startsOn, endsOn, reason, createdBy || null]
  );
  return normaliseClosure(Array.isArray(rows) ? rows[0] : null);
}

async function remove(id) {
  const shelterId = requireShelterId();
  const [result] = await pool.execute(
    'DELETE FROM shelter_closures WHERE shelter_id = ? AND id = ?',
    [shelterId, id]
  );
  return Boolean(result && result.affectedRows);
}

/**
 * Shifts starting inside [startsOn, endsOn] that still have live bookings
 * (pending, accepted, approved or waitlisted). Read only: the caller shows
 * these so staff can decide. Nothing is cancelled here.
 */
async function bookedShiftsBetween(startsOn, endsOn) {
  const shelterId = currentShelterId();
  if (!shelterId) return [];
  const [rows] = await pool.execute(
    `SELECT o.opportunity_id, o.title, o.start_date, o.end_date, o.location, o.status,
            COUNT(*) FILTER (WHERE a.status IN ('accepted', 'approved')) AS confirmed_count,
            COUNT(*) FILTER (WHERE a.status = 'pending') AS pending_count,
            COUNT(*) FILTER (WHERE a.status = 'waitlisted') AS waitlisted_count
       FROM opportunities o
       JOIN applications a
         ON a.opportunity_id = o.opportunity_id AND a.shelter_id = o.shelter_id
      WHERE o.shelter_id = ?
        AND o.status = 'open'
        AND CAST(o.start_date AS DATE) BETWEEN CAST(? AS DATE) AND CAST(? AS DATE)
        AND a.status IN ('pending', 'accepted', 'approved', 'waitlisted')
      GROUP BY o.opportunity_id, o.title, o.start_date, o.end_date, o.location, o.status
      ORDER BY o.start_date ASC, o.opportunity_id ASC
      LIMIT 500`,
    [shelterId, startsOn, endsOn]
  );
  return (Array.isArray(rows) ? rows : []).map((row) => ({
    opportunity_id: Number(row.opportunity_id),
    title: row.title || 'Shift',
    start_date: row.start_date,
    end_date: row.end_date,
    location: row.location || null,
    status: row.status,
    confirmed_count: Number(row.confirmed_count || 0),
    pending_count: Number(row.pending_count || 0),
    waitlisted_count: Number(row.waitlisted_count || 0),
  }));
}

module.exports = {
  list,
  findOverlapping,
  findById,
  create,
  remove,
  bookedShiftsBetween,
};
