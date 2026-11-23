import { escapeHtml } from './utils/escapeHtml.js';
import { formatDateOnly, toIsoDateLocal } from './utils/dateFormat.js';
import { withShelterQuery } from './shelterSlug.js';

export function defaultStatementRange() {
  const end = toIsoDateLocal(new Date());
  const start = `${end.slice(0, 4)}-01-01`;
  return { startDate: start, endDate: end };
}

export function formatHours(value) {
  const n = Number(value) || 0;
  return n.toLocaleString(undefined, {
    minimumFractionDigits: n % 1 === 0 ? 0 : 1,
    maximumFractionDigits: 2,
  });
}

export function renderStatementSheet(sheetEl, statement) {
  if (!sheetEl || !statement) return;

  const shelterName = statement.shelter?.name || 'Shelter';
  const hasLogo = Boolean(statement.shelter?.has_logo);
  const volunteerName = statement.volunteer?.name || 'Volunteer';
  const rangeLabel = `${formatDateOnly(statement.start_date) || statement.start_date} to ${
    formatDateOnly(statement.end_date) || statement.end_date
  }`;
  const signedRole = statement.signed_off_by?.role || 'Shelter staff';
  const shifts = Array.isArray(statement.shifts) ? statement.shifts : [];

  const logoHtml = hasLogo
    ? `<img class="hours-statement-logo" src="${escapeHtml(
        withShelterQuery('/api/public/brand/logo')
      )}" alt="${escapeHtml(shelterName)} logo" width="120" height="120" />`
    : '';

  const rowsHtml = shifts.length
    ? shifts
        .map((shift) => {
          const dateLabel = formatDateOnly(shift.date) || String(shift.date || '').slice(0, 10);
          const title = escapeHtml(shift.title || 'Volunteer shift');
          const location = shift.location
            ? `<span class="shift-location">${escapeHtml(shift.location)}</span>`
            : '';
          return `<tr>
            <td>${escapeHtml(dateLabel)}</td>
            <td>${title}${location ? `<br />${location}` : ''}</td>
            <td class="num">${escapeHtml(formatHours(shift.hours))}</td>
          </tr>`;
        })
        .join('')
    : `<tr><td colspan="3">No approved hours in this date range.</td></tr>`;

  sheetEl.innerHTML = `
    <header class="hours-statement-header">
      ${logoHtml}
      <div>
        <p class="shelter-name">${escapeHtml(shelterName)}</p>
        <p class="statement-title">Volunteer hours statement</p>
      </div>
    </header>
    <p class="lede">
      This statement confirms approved volunteer hours for school, Duke of Edinburgh,
      or employment references.
    </p>
    <dl class="statement-meta">
      <div><dt>Volunteer</dt><dd>${escapeHtml(volunteerName)}</dd></div>
      <div><dt>Period</dt><dd>${escapeHtml(rangeLabel)}</dd></div>
      <div><dt>Total hours</dt><dd>${escapeHtml(formatHours(statement.total_hours))}</dd></div>
      <div><dt>Shifts</dt><dd>${escapeHtml(String(statement.shift_count || 0))}</dd></div>
    </dl>
    <table class="hours-statement-table">
      <thead>
        <tr>
          <th scope="col">Date</th>
          <th scope="col">Shift</th>
          <th scope="col" class="num">Hours</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>
    <footer class="statement-signoff">
      <p>Signed off by: <strong>${escapeHtml(signedRole)}</strong></p>
      <p class="muted">Based on approved hours recorded in ShelterLink for ${escapeHtml(
        shelterName
      )}.</p>
    </footer>
  `;
  sheetEl.hidden = false;
}
