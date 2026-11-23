'use strict';

/**
 * Staff "this week" dashboard summary (SL-LATER-26).
 * Tenant-scoped via RLS / shelter context on every query.
 */

const { pool } = require('../config/database');
const { currentShelterId } = require('../utils/shelterContext');
const { todayIso, formatShelterDate, formatShelterTime } = require('../utils/shelterTime');

const TRAINING_EXPIRY_DAYS = 30;

function fail(status, message) {
  const error = new Error(message);
  error.status = status;
  return error;
}

function requireShelterId() {
  const id = currentShelterId();
  if (!id) throw fail(403, 'Shelter context is missing');
  return id;
}

function mondayOf(dateOnly) {
  const d = new Date(`${dateOnly}T12:00:00Z`);
  const day = d.getUTCDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function addDays(dateOnly, days) {
  const d = new Date(`${dateOnly}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addCalendarDays(dateOnly, days) {
  return addDays(dateOnly, days);
}

function filledCountSql() {
  return `
    (
      (
        SELECT COUNT(*)
        FROM applications a
        WHERE a.opportunity_id = o.opportunity_id
          AND a.status IN ('accepted', 'approved')
      )
      +
      (
        SELECT COALESCE(SUM(gb.size), 0)
        FROM group_bookings gb
        WHERE gb.opportunity_id = o.opportunity_id
          AND gb.status = 'confirmed'
      )
    )
  `;
}

function formatWhen(startDate, endDate) {
  const day = formatShelterDate(startDate);
  const startTime = formatShelterTime(startDate);
  const endTime = formatShelterTime(endDate);
  if (startTime && endTime) return `${day}, ${startTime} - ${endTime}`;
  if (startTime) return `${day}, ${startTime}`;
  return day;
}

function weekSheetHref(weekStart) {
  return `/pages/admin/week-sheet.html?week_start=${encodeURIComponent(weekStart)}`;
}

function volunteerHref(userId) {
  return `/pages/admin/volunteers.html?user=${encodeURIComponent(userId)}`;
}

async function listShiftsInWeek(weekStart, weekEnd) {
  const filled = filledCountSql();
  const [rows] = await pool.execute(
    `
      SELECT
        o.opportunity_id,
        o.title,
        o.location,
        o.start_date,
        o.end_date,
        o.max_volunteers,
        o.status,
        o.is_urgent,
        ${filled} AS spots_filled
      FROM opportunities o
      WHERE o.start_date::date >= ?::date
        AND o.start_date::date <= ?::date
        AND o.status IN ('open', 'closed')
      ORDER BY o.start_date ASC, o.opportunity_id ASC
    `,
    [weekStart, weekEnd]
  );
  return rows.map((row) => ({
    ...row,
    spots_filled: Number(row.spots_filled) || 0,
    max_volunteers:
      row.max_volunteers == null || row.max_volunteers === ''
        ? null
        : Number(row.max_volunteers),
  }));
}

function mapShiftItem(row, weekStart) {
  const filled = row.spots_filled;
  const max = row.max_volunteers;
  const spotsLabel =
    max == null ? `${filled} booked` : `${filled} of ${max} places filled`;
  const urgent = Number(row.is_urgent) ? ' Urgent. ' : '';
  return {
    id: `shift-${row.opportunity_id}`,
    opportunity_id: row.opportunity_id,
    title: row.title || 'Shift',
    detail: `${urgent}${formatWhen(row.start_date, row.end_date)}${
      row.location ? ` · ${row.location}` : ''
    } · ${spotsLabel}`,
    href: weekSheetHref(weekStart),
    spots_filled: filled,
    max_volunteers: max,
  };
}

async function listPendingBookings(weekStart, weekEnd) {
  const [rows] = await pool.execute(
    `
      SELECT
        a.application_id,
        a.user_id,
        a.opportunity_id,
        a.applied_at,
        u.first_name,
        u.last_name,
        u.email,
        o.title AS opportunity_title,
        o.start_date,
        o.end_date,
        o.location
      FROM applications a
      INNER JOIN users u ON u.user_id = a.user_id
      INNER JOIN opportunities o ON o.opportunity_id = a.opportunity_id
      WHERE a.status = 'pending'
        AND o.start_date::date >= ?::date
        AND o.start_date::date <= ?::date
      ORDER BY o.start_date ASC, a.applied_at ASC
    `,
    [weekStart, weekEnd]
  );
  return rows.map((row) => {
    const name =
      `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email || 'Volunteer';
    return {
      id: `pending-${row.application_id}`,
      application_id: row.application_id,
      opportunity_id: row.opportunity_id,
      user_id: row.user_id,
      title: name,
      detail: `${row.opportunity_title || 'Shift'} · ${formatWhen(
        row.start_date,
        row.end_date
      )}`,
      href: '/pages/admin/review-applications.html',
    };
  });
}

async function listTrainingExpiring(today, until) {
  const [rows] = await pool.execute(
    `
      SELECT
        vq.id AS volunteer_qualification_id,
        vq.user_id,
        vq.qualification_id,
        vq.expires_at,
        q.name AS qualification_name,
        u.first_name,
        u.last_name,
        u.email
      FROM volunteer_qualifications vq
      INNER JOIN qualifications q ON q.id = vq.qualification_id
      INNER JOIN users u ON u.user_id = vq.user_id
      WHERE vq.expires_at IS NOT NULL
        AND vq.expires_at >= ?::date
        AND vq.expires_at <= ?::date
      ORDER BY vq.expires_at ASC, vq.id ASC
    `,
    [today, until]
  );
  return rows.map((row) => {
    const name =
      `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email || 'Volunteer';
    return {
      id: `training-${row.volunteer_qualification_id}`,
      user_id: row.user_id,
      qualification_id: row.qualification_id,
      title: name,
      detail: `${row.qualification_name || 'Training'} expires ${formatShelterDate(
        row.expires_at
      )}`,
      href: volunteerHref(row.user_id),
      expires_at: row.expires_at,
    };
  });
}

async function listWaitlistOffers(weekStart, weekEnd) {
  const [rows] = await pool.execute(
    `
      SELECT
        w.id AS offer_id,
        w.opportunity_id,
        w.application_id,
        w.user_id,
        w.expires_at,
        w.notified_at,
        w.offered_at,
        u.first_name,
        u.last_name,
        u.email,
        o.title AS opportunity_title,
        o.start_date,
        o.end_date,
        o.location
      FROM waitlist_offers w
      INNER JOIN users u ON u.user_id = w.user_id
      INNER JOIN opportunities o ON o.opportunity_id = w.opportunity_id
      WHERE w.status = 'offered'
        AND o.start_date::date >= ?::date
        AND o.start_date::date <= ?::date
      ORDER BY COALESCE(w.expires_at, w.offered_at) ASC, w.id ASC
    `,
    [weekStart, weekEnd]
  );
  return rows.map((row) => {
    const name =
      `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.email || 'Volunteer';
    const expiry = row.expires_at
      ? ` · claim by ${formatShelterDate(row.expires_at)}`
      : row.notified_at
        ? ''
        : ' · waiting to notify';
    return {
      id: `offer-${row.offer_id}`,
      offer_id: row.offer_id,
      opportunity_id: row.opportunity_id,
      user_id: row.user_id,
      title: name,
      detail: `${row.opportunity_title || 'Shift'} · ${formatWhen(
        row.start_date,
        row.end_date
      )}${expiry}`,
      href: weekSheetHref(weekStart),
    };
  });
}

/**
 * Build the staff dashboard "this week" payload.
 */
async function getSummary(now = new Date()) {
  requireShelterId();

  const today = todayIso(now);
  const weekStart = mondayOf(today);
  const weekEnd = addDays(weekStart, 6);
  const trainingUntil = addCalendarDays(today, TRAINING_EXPIRY_DAYS);

  const [shifts, pending_bookings, training_expiring, waitlist_offers] =
    await Promise.all([
      listShiftsInWeek(weekStart, weekEnd),
      listPendingBookings(weekStart, weekEnd),
      listTrainingExpiring(today, trainingUntil),
      listWaitlistOffers(weekStart, weekEnd),
    ]);

  const unfilled = [];
  const short_staffed = [];
  for (const shift of shifts) {
    const max = shift.max_volunteers;
    if (max == null || max <= 0) continue;
    if (shift.spots_filled <= 0) {
      unfilled.push(mapShiftItem(shift, weekStart));
    } else if (shift.spots_filled < max) {
      short_staffed.push(mapShiftItem(shift, weekStart));
    }
  }

  return {
    week_start: weekStart,
    week_end: weekEnd,
    today,
    unfilled,
    short_staffed,
    pending_bookings,
    training_expiring,
    waitlist_offers,
    counts: {
      unfilled: unfilled.length,
      short_staffed: short_staffed.length,
      pending_bookings: pending_bookings.length,
      training_expiring: training_expiring.length,
      waitlist_offers: waitlist_offers.length,
    },
  };
}

module.exports = {
  getSummary,
  TRAINING_EXPIRY_DAYS,
  mondayOf,
  addDays,
};
