/**
 * Shared date/time formatting for shift information.
 *
 * The API returns MySQL-style 'YYYY-MM-DD HH:MM:SS' strings. Rendering those
 * directly is unreadable for volunteers, so every surface that shows a shift
 * time should go through formatShiftWhen().
 */

/**
 * 'YYYY-MM-DD' for a Date in the viewer's own local time. Never use
 * `date.toISOString().slice(0, 10)` for "today" — that renders in UTC, which
 * silently becomes tomorrow's (or yesterday's) date once local time crosses
 * a UTC day boundary (every evening for anywhere west of UTC).
 */
export function toIsoDateLocal(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Split a DB shift timestamp into separate `<input type="date">` and
 * `<input type="time">` values, for populating an edit form. Returns
 * `{ date: '', time: '' }` when the value can't be parsed.
 */
export function splitDateTime(value) {
  const date = parseShiftDate(value);
  if (!date) return { date: '', time: '' };
  const hh = String(date.getHours()).padStart(2, '0');
  const mm = String(date.getMinutes()).padStart(2, '0');
  return { date: toIsoDateLocal(date), time: `${hh}:${mm}` };
}

/**
 * Combine an `<input type="date">` value and an `<input type="time">` value
 * into the 'YYYY-MM-DD HH:MM:SS' shape the API expects. A missing time
 * defaults to midnight rather than being silently dropped — callers that
 * require a time should validate it themselves first.
 */
export function combineDateTime(dateValue, timeValue) {
  if (!dateValue) return null;
  const time = timeValue ? `${timeValue}${timeValue.length === 5 ? ':00' : ''}` : '00:00:00';
  return `${dateValue} ${time}`;
}

/**
 * Parse 'YYYY-MM-DD HH:MM:SS' (or ISO) into a local Date, without relying on
 * browser-specific handling of the space separator.
 * @returns {Date|null}
 */
export function parseShiftDate(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const m = String(value).match(
    /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?)?/
  );
  if (!m) return null;
  const [, y, mo, d, hh = '0', mi = '0', ss = '0'] = m;
  const date = new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(hh),
    Number(mi),
    Number(ss)
  );
  return Number.isNaN(date.getTime()) ? null : date;
}

/** "Today", "Tomorrow", "Sat 15 Aug", or "Sat 15 Aug 2027" across a year boundary. */
export function formatDayLabel(date, now = new Date()) {
  const dayDiff = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()) -
      new Date(now.getFullYear(), now.getMonth(), now.getDate())) /
      86400000
  );
  if (dayDiff === 0) return 'Today';
  if (dayDiff === 1) return 'Tomorrow';
  if (dayDiff === -1) return 'Yesterday';

  const opts = { weekday: 'short', day: 'numeric', month: 'short' };
  if (date.getFullYear() !== now.getFullYear()) opts.year = 'numeric';
  return date.toLocaleDateString('en-GB', opts);
}

/** 24-hour time, e.g. "09:00". */
export function formatTimeLabel(date) {
  return date.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
}

/** Date with no time, e.g. "15 Aug 2026". Used for "Applied ..." style lines. */
export function formatDateOnly(value) {
  const date = parseShiftDate(value);
  if (!date) return '';
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Human-readable shift timing.
 *   same day  -> "Sat 15 Aug, 09:00 - 12:00"
 *   overnight -> "Sat 15 Aug, 22:00 - Sun 16 Aug, 02:00"
 * Falls back to the raw value if it cannot be parsed.
 */
export function formatShiftWhen(startValue, endValue) {
  const start = parseShiftDate(startValue);
  if (!start) return startValue ? String(startValue) : 'Flexible dates';

  const end = parseShiftDate(endValue);
  const day = formatDayLabel(start);
  const startTime = formatTimeLabel(start);

  if (!end) return `${day}, ${startTime}`;

  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  if (sameDay) return `${day}, ${startTime} - ${formatTimeLabel(end)}`;
  return `${day}, ${startTime} - ${formatDayLabel(end)}, ${formatTimeLabel(end)}`;
}

/**
 * Drop shifts that have already finished and order the rest soonest-first.
 * The opportunities endpoint returns newest-created first and includes past
 * dates, which is wrong for anything a volunteer is choosing from.
 */
function shiftEndValue(opp) {
  if (!opp) return null;
  return opp.end_date || opp.end || opp.start_date || opp.start;
}

function shiftStartValue(opp) {
  if (!opp) return null;
  return opp.start_date || opp.start || opp.end_date || opp.end;
}

export function upcomingFirst(opportunities, now = new Date()) {
  const cutoff = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return (opportunities || [])
    .filter((opp) => {
      if (!opp) return false;
      const end = parseShiftDate(shiftEndValue(opp));
      if (!end) return true; // undated shifts stay visible
      return end >= cutoff;
    })
    .sort((a, b) => {
      const aUrgent = Number(a.is_urgent) ? 1 : 0;
      const bUrgent = Number(b.is_urgent) ? 1 : 0;
      if (aUrgent !== bUrgent) return bUrgent - aUrgent;
      const aDate = parseShiftDate(shiftStartValue(a));
      const bDate = parseShiftDate(shiftStartValue(b));
      if (!aDate && !bDate) return 0;
      if (!aDate) return 1;
      if (!bDate) return -1;
      return aDate - bDate;
    });
}
