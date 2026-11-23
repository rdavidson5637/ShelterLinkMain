import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';
import { formatShiftWhen, toIsoDateLocal } from '../utils/dateFormat.js';

const sheetDateInput = document.getElementById('sheetDate');
const shiftFilter = document.getElementById('shiftFilter');
const loadButton = document.getElementById('loadButton');
const printButton = document.getElementById('printButton');
const contentEl = document.getElementById('signInSheetContent');
const messageEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');

const WALK_IN_ROWS = 3;

/** Last loaded sheet; used when the shift filter changes without a re-fetch. */
let cachedSheet = null;

function todayIso() {
  return toIsoDateLocal();
}

function setMessage(type, text) {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const css = type === 'error' ? 'error-message' : 'success-message';
  const note = document.createElement('p');
  note.className = css;
  note.textContent = text;
  messageEl.replaceChildren(note);
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function blankCells() {
  return `
    <td class="signin-blank" aria-hidden="true"></td>
    <td class="signin-blank" aria-hidden="true"></td>
    <td class="signin-blank" aria-hidden="true"></td>
  `;
}

function renderVolunteerRow(v) {
  return `<tr>
    <td>${escapeHtml(v.name)}</td>
    ${blankCells()}
  </tr>`;
}

function renderWalkInRows() {
  return Array.from({ length: WALK_IN_ROWS }, () => {
    return `<tr class="signin-walkin">
      <td></td>
      ${blankCells()}
    </tr>`;
  }).join('');
}

function staffEmergencyNote() {
  return `
    <aside class="signin-staff-note" aria-label="Staff emergency contact note">
      <strong>Staff only - emergency contacts</strong>
      Look up name, relationship and phone on the volunteer&rsquo;s profile under Volunteers in ShelterLink
      <a class="no-print" href="/pages/admin/volunteers.html">(open Volunteers)</a>.
      Do not write emergency details on this sheet or leave it in a public place after the shift.
    </aside>
  `;
}

function renderShift(opp) {
  const volunteers = opp.volunteers || [];
  const bookedRows = volunteers.length
    ? volunteers.map(renderVolunteerRow).join('')
    : '<tr><td colspan="4">No booked volunteers yet.</td></tr>';

  return `
    <article class="signin-shift">
      <h2>${escapeHtml(opp.title || 'Shift')}</h2>
      <p class="signin-meta">
        ${escapeHtml(formatShiftWhen(opp.start_date, opp.end_date))}
        · ${escapeHtml(opp.location || 'Location TBA')}
        · Booked: ${volunteers.length}${
          opp.max_volunteers != null ? ` / ${opp.max_volunteers}` : ''
        }
      </p>
      <table class="signin-table">
        <caption class="visually-hidden">${escapeHtml(opp.title || 'Shift')} sign-in</caption>
        <thead>
          <tr>
            <th scope="col" class="col-name">Name</th>
            <th scope="col" class="col-time">Time in</th>
            <th scope="col" class="col-time">Time out</th>
            <th scope="col" class="col-sign">Signature</th>
          </tr>
        </thead>
        <tbody>
          ${bookedRows}
          ${renderWalkInRows()}
        </tbody>
      </table>
      ${staffEmergencyNote()}
    </article>
  `;
}

function populateShiftFilter(opportunities, selectedId) {
  if (!shiftFilter) return;
  const keep = selectedId != null ? String(selectedId) : shiftFilter.value;
  shiftFilter.replaceChildren();
  const all = document.createElement('option');
  all.value = '';
  all.textContent = 'All shifts this day';
  shiftFilter.appendChild(all);
  for (const opp of opportunities || []) {
    const opt = document.createElement('option');
    opt.value = String(opp.opportunity_id ?? opp.id);
    const when = formatShiftWhen(opp.start_date, opp.end_date);
    opt.textContent = `${opp.title || 'Shift'} — ${when}`;
    shiftFilter.appendChild(opt);
  }
  if (keep && [...shiftFilter.options].some((o) => o.value === keep)) {
    shiftFilter.value = keep;
  } else {
    shiftFilter.value = '';
  }
}

function renderSheet(sheet) {
  if (!contentEl) return;
  let opportunities = sheet.opportunities || [];
  const filterId = shiftFilter?.value;
  if (filterId) {
    opportunities = opportunities.filter(
      (o) => String(o.opportunity_id ?? o.id) === filterId
    );
  }
  if (!opportunities.length) {
    contentEl.innerHTML = filterId
      ? '<p>That shift is not on the loaded day.</p>'
      : `<p>No shifts on ${escapeHtml(sheet.date)}.</p>`;
    return;
  }
  contentEl.innerHTML = `
    <p class="no-print muted">Sign-in for ${escapeHtml(sheet.date)}</p>
    ${opportunities.map(renderShift).join('')}
  `;
}

async function loadSheet() {
  const date = sheetDateInput?.value || todayIso();
  setMessage();
  if (contentEl) contentEl.innerHTML = '<p>Loading…</p>';
  try {
    const res = await apiRequest(`/admin/day-sheet?date=${encodeURIComponent(date)}`);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage('error', err.error || 'Unable to load sign-in sheet.');
      cachedSheet = null;
      if (contentEl) contentEl.innerHTML = '';
      return;
    }
    const sheet = await res.json();
    cachedSheet = sheet;
    populateShiftFilter(sheet.opportunities || []);
    const params = new URLSearchParams(window.location.search);
    const oppParam = params.get('opportunity_id') || params.get('shift');
    if (oppParam && shiftFilter) {
      const match = [...shiftFilter.options].some((o) => o.value === String(oppParam));
      if (match) shiftFilter.value = String(oppParam);
    }
    renderSheet(sheet);
  } catch (error) {
    console.error('[SignInSheet] load error:', error);
    setMessage('error', 'Network error loading sign-in sheet.');
    cachedSheet = null;
  }
}

function applyFilterFromUi() {
  if (!cachedSheet) {
    loadSheet().catch(() => {});
    return;
  }
  renderSheet(cachedSheet);
}

async function init() {
  await requireAuth();
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  applyRoleVisibility(user);

  const params = new URLSearchParams(window.location.search);
  const dateParam = params.get('date');
  if (sheetDateInput) {
    sheetDateInput.value =
      dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayIso();
  }

  loadButton?.addEventListener('click', () => loadSheet().catch(() => {}));
  printButton?.addEventListener('click', () => window.print());
  shiftFilter?.addEventListener('change', () => applyFilterFromUi());
  logoutButton?.addEventListener('click', () => logout());
  await loadSheet();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => console.error(err));
});
