'use strict';

// Volunteer attendance over the last 12 months, for staff only (SL-LATER-34).
// Computed from existing rows: no extra tables.
//
//   attended            accepted place on a shift that started in the window,
//                       not marked no-show, and either checked in or with
//                       approved hours logged against that shift.
//   no_shows            place marked no-show by staff.
//   late_cancellations  place given up through a claimed swap that was asked
//                       for inside the shift's cancellation cutoff. Volunteers
//                       cannot self-cancel inside the cutoff, so this is the
//                       only late hand-back the data keeps. Cancellations made
//                       before the cutoff delete the application and are not late.
//   hours               approved hours dated in the window.
//
// Every query touches tenant tables, so row-level security limits it to the
// caller's shelter.

const { pool } = require('../config/database');

const WINDOW_MONTHS = 12;

function pad(n) {
  return String(n).padStart(2, '0');
}

function toTimestamp(d) {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(
    d.getUTCHours()
  )}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}

function reliabilityWindow(now = new Date()) {
  const end = new Date(now.getTime());
  const start = new Date(now.getTime());
  start.setUTCMonth(start.getUTCMonth() - WINDOW_MONTHS);
  return {
    start: toTimestamp(start),
    end: toTimestamp(end),
    startDate: toTimestamp(start).slice(0, 10),
    endDate: toTimestamp(end).slice(0, 10),
  };
}

function emptyCounts() {
  return { attended: 0, no_shows: 0, late_cancellations: 0, hours: 0 };
}

async function countsByUser({ userId = null, now = new Date() } = {}) {
  const win = reliabilityWindow(now);
  const userFilter = userId != null ? 'AND a.user_id = ?' : '';
  const shiftParams = [win.start, win.end];
  if (userId != null) shiftParams.push(userId);

  const shiftSql = `
    SELECT
      a.user_id,
      SUM(CASE
            WHEN a.status IN ('accepted', 'approved')
             AND COALESCE(a.no_show, 0) = 0
             AND (
               a.checked_in_at IS NOT NULL
               OR EXISTS (
                 SELECT 1 FROM volunteer_hours vh
                 WHERE vh.user_id = a.user_id
                   AND vh.opportunity_id = a.opportunity_id
                   AND vh.approved = 1
               )
             )
            THEN 1 ELSE 0 END) AS attended,
      SUM(CASE WHEN COALESCE(a.no_show, 0) = 1 THEN 1 ELSE 0 END) AS no_shows,
      SUM(CASE
            WHEN a.status = 'cancelled'
             AND EXISTS (
               SELECT 1 FROM swap_requests sr
               WHERE sr.application_id = a.application_id
                 AND sr.status = 'claimed'
                 AND sr.requested_at >= o.start_date
                     - (COALESCE(o.cancellation_cutoff_hours, 24) * INTERVAL '1 hour')
             )
            THEN 1 ELSE 0 END) AS late_cancellations
    FROM applications a
    JOIN opportunities o ON o.opportunity_id = a.opportunity_id
    WHERE o.start_date >= CAST(? AS TIMESTAMP)
      AND o.start_date <= CAST(? AS TIMESTAMP)
      ${userFilter}
    GROUP BY a.user_id
  `;

  const hoursFilter = userId != null ? 'AND vh.user_id = ?' : '';
  const hoursParams = [win.startDate, win.endDate];
  if (userId != null) hoursParams.push(userId);
  const hoursSql = `
    SELECT vh.user_id, COALESCE(SUM(vh.hours), 0) AS hours
    FROM volunteer_hours vh
    WHERE vh.approved = 1
      AND vh.date >= CAST(? AS DATE)
      AND vh.date <= CAST(? AS DATE)
      ${hoursFilter}
    GROUP BY vh.user_id
  `;

  const [[shiftRows], [hourRows]] = await Promise.all([
    pool.execute(shiftSql, shiftParams),
    pool.execute(hoursSql, hoursParams),
  ]);

  const byUser = new Map();
  const entry = (id) => {
    const key = Number(id);
    if (!byUser.has(key)) byUser.set(key, emptyCounts());
    return byUser.get(key);
  };
  for (const row of shiftRows || []) {
    const e = entry(row.user_id);
    e.attended = Number(row.attended) || 0;
    e.no_shows = Number(row.no_shows) || 0;
    e.late_cancellations = Number(row.late_cancellations) || 0;
  }
  for (const row of hourRows || []) {
    entry(row.user_id).hours = Math.round((Number(row.hours) || 0) * 100) / 100;
  }
  return { window: win, byUser };
}

async function forVolunteer(userId, { now = new Date() } = {}) {
  const { window: win, byUser } = await countsByUser({ userId: Number(userId), now });
  return {
    window_start: win.startDate,
    window_end: win.endDate,
    ...(byUser.get(Number(userId)) || emptyCounts()),
  };
}

module.exports = {
  WINDOW_MONTHS,
  reliabilityWindow,
  countsByUser,
  forVolunteer,
  emptyCounts,
};
