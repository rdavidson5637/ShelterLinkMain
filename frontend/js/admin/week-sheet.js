import { apiRequest, API_URL } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';
import { formatShiftWhen, toIsoDateLocal } from '../utils/dateFormat.js';

const weekStartInput = document.getElementById('weekStart');
const loadButton = document.getElementById('loadButton');
const printButton = document.getElementById('printButton');
const icsDownload = document.getElementById('icsDownload');
const contentEl = document.getElementById('weekSheetContent');
const messageEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');

function mondayOf(isoDate) {
  // Noon avoids DST-transition edge cases when shifting by whole days.
  const d = new Date(`${isoDate}T12:00:00`);
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return toIsoDateLocal(d);
}

function todayMonday() {
  return mondayOf(toIsoDateLocal());
}

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const css = type === 'error' ? 'error-message' : 'success-message';
  messageEl.innerHTML = `<p class="${css}">${text}</p>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatDayHeading(dateIso) {
  const d = new Date(`${dateIso}T12:00:00`);
  return d.toLocaleDateString('en-GB', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

function updateIcsLink(weekStart) {
  if (!icsDownload) return;
  icsDownload.href = `${API_URL}/admin/week-sheet.ics?week_start=${encodeURIComponent(weekStart)}`;
}

function renderVolunteerRow(v) {
  return `<tr>
    <td>${escapeHtml(v.name)}</td>
    <td>${escapeHtml(v.phone || '—')}</td>
    <td>${escapeHtml(v.check_in_status || '—')}</td>
  </tr>`;
}

function renderAnimal(a) {
  const photo = a.photo_filename
    ? `<img class="animal-thumb" src="/api/animals/${Number(a.id)}/photo" alt="" width="40" height="40" />`
    : '';
  const handling = a.handling_notes
    ? ` — <span class="handling-warn">${escapeHtml(a.handling_notes)}</span>`
    : '';
  return `<li>${photo}<span><strong>${escapeHtml(a.name)}</strong> (${escapeHtml(a.species)})${
    a.kennel_ref ? ` · ${escapeHtml(a.kennel_ref)}` : ''
  }${handling}</span></li>`;
}

function renderShift(opp) {
  const animals = (opp.animals || []).map(renderAnimal).join('');
  const volunteers = opp.volunteers || [];
  const tableBody = volunteers.length
    ? volunteers.map(renderVolunteerRow).join('')
    : '<tr><td colspan="3">No accepted volunteers yet.</td></tr>';
  const urgent = opp.is_urgent ? ' <strong>(URGENT)</strong>' : '';

  return `
    <article class="week-sheet-shift">
      <h3>${escapeHtml(opp.title || 'Shift')}${urgent}</h3>
      <p class="week-sheet-meta">
        ${escapeHtml(formatShiftWhen(opp.start_date, opp.end_date))}
        · ${escapeHtml(opp.location || 'Location TBA')}
        · Code: <code>${escapeHtml(opp.check_in_code || '—')}</code>
        · Waitlist: ${Number(opp.waitlist_count) || 0}
        · Spots: ${volunteers.length}${
          opp.max_volunteers != null ? ` / ${opp.max_volunteers}` : ''
        }
      </p>
      ${animals ? `<ul class="week-sheet-animals">${animals}</ul>` : ''}
      <table>
        <caption>Accepted volunteers</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Phone</th>
            <th scope="col">Check-in</th>
          </tr>
        </thead>
        <tbody>${tableBody}</tbody>
      </table>
    </article>
  `;
}

function renderDay(day) {
  const shifts = day.opportunities || [];
  const body = shifts.length
    ? shifts.map(renderShift).join('')
    : '<p>No shifts this day.</p>';
  return `
    <section class="week-sheet-day">
      <h2>${escapeHtml(formatDayHeading(day.date))}</h2>
      ${body}
    </section>
  `;
}

async function loadSheet() {
  let weekStart = weekStartInput?.value || todayMonday();
  weekStart = mondayOf(weekStart);
  if (weekStartInput) weekStartInput.value = weekStart;
  updateIcsLink(weekStart);
  setMessage();
  if (contentEl) contentEl.innerHTML = '<p>Loading…</p>';
  try {
    const res = await apiRequest(
      `/admin/week-sheet?week_start=${encodeURIComponent(weekStart)}`
    );
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage('error', err.error || 'Unable to load week sheet.');
      if (contentEl) contentEl.innerHTML = '';
      return;
    }
    const sheet = await res.json();
    const total = sheet.opportunities?.length || 0;
    contentEl.innerHTML = `
      <h2 class="no-print">Week of ${escapeHtml(sheet.week_start)} – ${escapeHtml(
        sheet.week_end
      )} (${total} shift${total === 1 ? '' : 's'})</h2>
      ${(sheet.days || []).map(renderDay).join('')}
    `;
  } catch (error) {
    console.error('[WeekSheet] load error:', error);
    setMessage('error', 'Network error loading week sheet.');
  }
}

async function init() {
  await requireAuth();
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user?.role)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  applyRoleVisibility(user?.role);
  if (weekStartInput) weekStartInput.value = todayMonday();
  updateIcsLink(weekStartInput?.value || todayMonday());
  loadButton?.addEventListener('click', () => loadSheet().catch(() => {}));
  printButton?.addEventListener('click', () => window.print());
  weekStartInput?.addEventListener('change', () => {
    if (!weekStartInput.value) return;
    weekStartInput.value = mondayOf(weekStartInput.value);
    updateIcsLink(weekStartInput.value);
  });
  logoutButton?.addEventListener('click', () => logout());
  await loadSheet();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => console.error(err));
});
