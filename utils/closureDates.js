'use strict';

/**
 * Pure helpers for shelter closure dates (SL-LATER-30). Dates are
 * shelter-local 'YYYY-MM-DD' strings. Shift start_date values are naive
 * local timestamps ('YYYY-MM-DD HH:mm:ss'), so the first ten characters are
 * the shift's own day.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MAX_RANGE_DAYS = 366;
const REASON_MAX = 120;

function isIsoDate(value) {
  const m = ISO_DATE.exec(String(value || ''));
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return (
    d.getUTCFullYear() === Number(m[1])
    && d.getUTCMonth() === Number(m[2]) - 1
    && d.getUTCDate() === Number(m[3])
  );
}

function dayOf(value) {
  if (!value) return null;
  const text = value instanceof Date ? value.toISOString() : String(value);
  const day = text.slice(0, 10);
  return isIsoDate(day) ? day : null;
}

function daysBetween(from, to) {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  return Math.round((b - a) / 86400000);
}

/** A closure row with valid dates, or null. Guards against odd DB rows. */
function normaliseClosure(row) {
  if (!row) return null;
  const startsOn = dayOf(row.starts_on);
  const endsOn = dayOf(row.ends_on);
  if (!startsOn || !endsOn || endsOn < startsOn) return null;
  return {
    id: Number(row.id) || null,
    starts_on: startsOn,
    ends_on: endsOn,
    reason: String(row.reason || '').trim() || 'Closed',
    created_at: row.created_at || null,
  };
}

function normaliseClosures(rows) {
  return (Array.isArray(rows) ? rows : []).map(normaliseClosure).filter(Boolean);
}

/** The first closure covering this day (or a shift start), or null. */
function closureOn(closures, value) {
  const day = dayOf(value);
  if (!day) return null;
  return (closures || []).find((c) => c.starts_on <= day && day <= c.ends_on) || null;
}

/**
 * Validate admin input for a new closure. Returns { value } or { error }.
 * ends_on is optional: a single closed day.
 */
function parseClosureInput(body = {}) {
  const startsOn = String(body.starts_on || '').trim();
  const endsOn = String(body.ends_on || '').trim() || startsOn;
  const reason = String(body.reason || '').trim().replace(/\s+/g, ' ');
  if (!isIsoDate(startsOn)) return { error: 'Enter the first closed day as a date' };
  if (!isIsoDate(endsOn)) return { error: 'Enter the last closed day as a date' };
  if (endsOn < startsOn) return { error: 'The last closed day must be on or after the first' };
  if (daysBetween(startsOn, endsOn) + 1 > MAX_RANGE_DAYS) {
    return { error: `A closure can cover at most ${MAX_RANGE_DAYS} days` };
  }
  if (!reason) return { error: 'Enter a short reason, for example Christmas' };
  if (reason.length > REASON_MAX) return { error: `Keep the reason under ${REASON_MAX} characters` };
  return { value: { starts_on: startsOn, ends_on: endsOn, reason } };
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatDay(day) {
  const m = ISO_DATE.exec(String(day || ''));
  if (!m) return String(day || '');
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return `${DAYS[d.getUTCDay()]} ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

/** Message for a refused shift. Names the day and the reason. */
function closedDayMessage(closure, day) {
  return `The shelter is closed on ${formatDay(day)} (${closure.reason}). Pick another date or remove the closure first.`;
}

module.exports = {
  isIsoDate,
  dayOf,
  daysBetween,
  normaliseClosure,
  normaliseClosures,
  closureOn,
  parseClosureInput,
  formatDay,
  closedDayMessage,
  MAX_RANGE_DAYS,
  REASON_MAX,
};
