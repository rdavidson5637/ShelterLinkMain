'use strict';

/**
 * Staff week coverage summary (SL-DAY-07).
 * Counts open slots vs filled from existing shift / booking data only.
 * Does not score or judge individual volunteers.
 */

function toFilled(opp) {
  if (Array.isArray(opp.volunteers)) return opp.volunteers.length;
  if (opp.spots_filled != null && opp.spots_filled !== '') {
    return Math.max(0, Number(opp.spots_filled) || 0);
  }
  return 0;
}

function toMax(opp) {
  if (opp.max_volunteers == null || opp.max_volunteers === '') return null;
  const n = Number(opp.max_volunteers);
  return Number.isFinite(n) ? n : null;
}

function roleKey(opp) {
  const title = String(opp.title || '').trim();
  return title || 'Shift';
}

/**
 * Per-shift open/filled counts.
 * Open is null when capacity is uncapped (max_volunteers missing).
 */
function shiftCoverage(opp) {
  const filled = toFilled(opp);
  const max = toMax(opp);
  const open = max == null ? null : Math.max(0, max - filled);
  return {
    opportunity_id: opp.opportunity_id || opp.id || null,
    title: roleKey(opp),
    filled,
    max_volunteers: max,
    open,
  };
}

function emptyTotals() {
  return {
    shift_count: 0,
    filled: 0,
    capacity: 0,
    open: 0,
    uncapped_shifts: 0,
    capped_shifts: 0,
  };
}

function addShift(totals, shift) {
  totals.shift_count += 1;
  totals.filled += shift.filled;
  if (shift.max_volunteers == null) {
    totals.uncapped_shifts += 1;
  } else {
    totals.capped_shifts += 1;
    totals.capacity += shift.max_volunteers;
    totals.open += shift.open || 0;
  }
  return totals;
}

/**
 * Coverage level for heat tint + text label.
 * Never relies on colour alone in the UI — labels come from describeLevel.
 */
function coverageLevel(totals) {
  if (!totals.shift_count) return 'none';
  if (totals.capped_shifts === 0) {
    return totals.filled > 0 ? 'uncapped' : 'uncapped_empty';
  }
  if (totals.open === 0) return 'full';
  if (totals.filled === 0) return 'empty';
  const ratio = totals.capacity > 0 ? totals.filled / totals.capacity : 0;
  if (ratio < 0.5) return 'short';
  return 'partial';
}

function describeLevel(level) {
  switch (level) {
    case 'none':
      return 'No shifts';
    case 'full':
      return 'Full';
    case 'empty':
      return 'Unfilled';
    case 'short':
      return 'Short';
    case 'partial':
      return 'Partly filled';
    case 'uncapped':
      return 'Booked (no cap)';
    case 'uncapped_empty':
      return 'No bookings (no cap)';
    default:
      return 'Coverage';
  }
}

function summarise(shifts) {
  const totals = shifts.reduce((acc, shift) => addShift(acc, shift), emptyTotals());
  const level = coverageLevel(totals);
  return {
    ...totals,
    level,
    level_label: describeLevel(level),
  };
}

function buildDayCoverage(day) {
  const opportunities = day.opportunities || [];
  const shifts = opportunities.map(shiftCoverage);
  return {
    date: day.date,
    ...summarise(shifts),
    shifts,
  };
}

/**
 * Group shifts that share a title — titles are the existing "role" on
 * opportunities (schema: volunteer shifts / roles). No separate role table.
 */
function buildRoleCoverage(allShifts) {
  const byTitle = new Map();
  for (const shift of allShifts) {
    const key = shift.title;
    const list = byTitle.get(key) || [];
    list.push(shift);
    byTitle.set(key, list);
  }
  return [...byTitle.entries()]
    .map(([title, shifts]) => ({
      title,
      ...summarise(shifts),
    }))
    .sort((a, b) => {
      if (b.open !== a.open) return b.open - a.open;
      return a.title.localeCompare(b.title);
    });
}

/**
 * @param {Array<{ date: string, opportunities: object[] }>} days
 *   Monday–Sunday week sheet days from DaySheet.getForWeek.
 */
function buildWeekCoverage(days) {
  const dayRows = (days || []).map(buildDayCoverage);
  const allShifts = dayRows.flatMap((d) => d.shifts);
  const week = summarise(allShifts);
  const roles = buildRoleCoverage(allShifts);
  return {
    week,
    days: dayRows,
    roles,
  };
}

module.exports = {
  shiftCoverage,
  coverageLevel,
  describeLevel,
  summarise,
  buildDayCoverage,
  buildRoleCoverage,
  buildWeekCoverage,
};
