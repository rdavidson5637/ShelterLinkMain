import { parseShiftDate } from './dateFormat.js';

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + days);
  return next;
}

/** Monday-start week (Northern Ireland / ISO). Sunday belongs to the week that began the previous Monday. */
export function startOfWeekMonday(date) {
  const day = date.getDay();
  const offset = day === 0 ? -6 : 1 - day;
  return addDays(startOfDay(date), offset);
}

function monthYearLabel(date) {
  return date.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' });
}

function laterInMonthLabel(date) {
  const month = date.toLocaleDateString('en-GB', { month: 'long' });
  return `Later in ${month}`;
}

/**
 * Group already-sorted upcoming shifts under scannable period headings.
 * Empty groups are omitted. Within a group, input order is preserved
 * (callers should pass upcomingFirst() output).
 *
 * @returns {{ key: string, heading: string, shifts: object[] }[]}
 */
export function groupShiftsByPeriod(shifts, now = new Date()) {
  const list = Array.isArray(shifts) ? shifts : [];
  if (!list.length) return [];

  const today = startOfDay(now);
  const tomorrow = addDays(today, 1);
  const thisWeekStart = startOfWeekMonday(today);
  const nextWeekStart = addDays(thisWeekStart, 7);
  const weekAfterNext = addDays(nextWeekStart, 7);

  const buckets = new Map();

  function push(key, heading, shift) {
    if (!buckets.has(key)) buckets.set(key, { key, heading, shifts: [] });
    buckets.get(key).shifts.push(shift);
  }

  list.forEach((shift) => {
    const start = parseShiftDate(shift.start_date) || parseShiftDate(shift.end_date);
    if (!start) {
      push('undated', 'Later', shift);
      return;
    }
    const day = startOfDay(start);

    if (day.getTime() === today.getTime()) {
      push('today', 'Today', shift);
      return;
    }
    if (day.getTime() === tomorrow.getTime()) {
      push('tomorrow', 'Tomorrow', shift);
      return;
    }
    if (day >= today && day < nextWeekStart) {
      push('this-week', 'This week', shift);
      return;
    }
    if (day >= nextWeekStart && day < weekAfterNext) {
      push('next-week', 'Next week', shift);
      return;
    }
    if (
      start.getFullYear() === now.getFullYear() &&
      start.getMonth() === now.getMonth()
    ) {
      push('later-month', laterInMonthLabel(now), shift);
      return;
    }
    const heading = monthYearLabel(start);
    push(`month-${start.getFullYear()}-${start.getMonth()}`, heading, shift);
  });

  return Array.from(buckets.values());
}
