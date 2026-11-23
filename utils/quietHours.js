'use strict';

/**
 * Volunteer quiet hours (SL-LATER-16).
 *
 * Times are wall-clock in the shelter timezone (SHELTER_TIMEZONE / Europe/London).
 * A window that wraps midnight (e.g. 22:00–08:00) is supported. Incomplete
 * pairs (only one side set) count as no quiet hours.
 */

function shelterZone() {
  const zone = String(process.env.SHELTER_TIMEZONE || '').trim();
  return zone || 'Europe/London';
}

/** 'HH:MM' in the shelter timezone for `now`. Fresh each call so tests can swap the zone. */
function localClockHm(now = new Date()) {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone: shelterZone(),
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
    const map = {};
    for (const part of parts) {
      if (part.type !== 'literal') map[part.type] = part.value;
    }
    const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
    const minute = Number(map.minute);
    if (!Number.isInteger(hour) || !Number.isInteger(minute)) return null;
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  } catch {
    return null;
  }
}

function parseClockToMinutes(value) {
  if (value == null || value === '') return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.getUTCHours() * 60 + value.getUTCMinutes();
  }
  const raw = String(value).trim();
  const m = raw.match(/^(\d{1,2}):(\d{2})(?::\d{2})?(?:\.\d+)?$/);
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null;
  if (!Number.isInteger(minute) || minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

/** Normalise a form/API value to 'HH:MM' or null. */
function normaliseQuietTime(value) {
  const mins = parseClockToMinutes(value);
  if (mins == null) return null;
  const hour = Math.floor(mins / 60);
  const minute = mins % 60;
  return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/**
 * True when now falls inside [start, end) in shelter local time.
 * Overnight windows (start > end) wrap past midnight.
 */
function isInQuietHours(start, end, now = new Date()) {
  const startMins = parseClockToMinutes(start);
  const endMins = parseClockToMinutes(end);
  if (startMins == null || endMins == null) return false;
  if (startMins === endMins) return false;

  const nowMins = parseClockToMinutes(localClockHm(now));
  if (nowMins == null) return false;

  if (startMins < endMins) {
    return nowMins >= startMins && nowMins < endMins;
  }
  // Overnight: e.g. 22:00–08:00
  return nowMins >= startMins || nowMins < endMins;
}

function rowInQuietHours(row, now = new Date()) {
  if (!row) return false;
  return isInQuietHours(row.quiet_hours_start, row.quiet_hours_end, now);
}

module.exports = {
  parseClockToMinutes,
  normaliseQuietTime,
  isInQuietHours,
  rowInQuietHours,
};
