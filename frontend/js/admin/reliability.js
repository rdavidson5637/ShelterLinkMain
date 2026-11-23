// Staff-only attendance helpers for the volunteers page (SL-LATER-34).
// Kept free of DOM access so they can be tested directly.
import { escapeHtml } from '../utils/escapeHtml.js';

function formatHours(num) {
  return Number(num || 0).toLocaleString(undefined, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

function volunteerName(v) {
  return `${v.first_name || ''} ${v.last_name || ''}`.trim().toLowerCase();
}

// Sort a copy of the list by the chosen column. Ties fall back to name so the
// order stays stable between clicks.
export function sortVolunteers(list, key, dir) {
  const factor = dir === 'descending' ? -1 : 1;
  return [...list].sort((a, b) => {
    let cmp = 0;
    if (key !== 'name') {
      cmp = (Number(a[key]) || 0) - (Number(b[key]) || 0);
    }
    if (cmp === 0) cmp = volunteerName(a).localeCompare(volunteerName(b));
    return cmp * factor;
  });
}

export function reliabilitySectionHtml(r = {}) {
  const rows = [
    ['Attended', String(Number(r.attended) || 0)],
    ['No-shows', String(Number(r.no_shows) || 0)],
    ['Late cancellations', String(Number(r.late_cancellations) || 0)],
    ['Approved hours', formatHours(r.hours)],
  ];
  const range =
    r.window_start && r.window_end
      ? `<small>Shifts from ${escapeHtml(r.window_start)} to ${escapeHtml(r.window_end)}. Staff only.</small>`
      : '';
  return `<table class="reliability-table"><tbody>${rows
    .map(
      ([label, value]) =>
        `<tr><th scope="row">${escapeHtml(label)}</th><td class="numeric-cell">${escapeHtml(value)}</td></tr>`
    )
    .join('')}</tbody></table>${range}`;
}
