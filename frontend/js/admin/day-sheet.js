import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';
import { formatShiftWhen, toIsoDateLocal } from '../utils/dateFormat.js';

const sheetDateInput = document.getElementById('sheetDate');
const loadButton = document.getElementById('loadButton');
const printButton = document.getElementById('printButton');
const contentEl = document.getElementById('daySheetContent');
const messageEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');

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
  messageEl.innerHTML = `<p class="${css}">${text}</p>`;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderAnimal(a) {
  const photo = a.photo_filename
    ? `<img class="animal-thumb" src="/api/animals/${Number(a.id)}/photo" alt="" width="48" height="48" />`
    : '';
  const handling = a.handling_notes
    ? ` — <span class="handling-warn">${escapeHtml(a.handling_notes)}</span>`
    : '';
  return `<li class="day-sheet-animal">${photo}<span><strong>${escapeHtml(a.name)}</strong> (${escapeHtml(a.species)})${
    a.kennel_ref ? ` · ${escapeHtml(a.kennel_ref)}` : ''
  }${handling}</span></li>`;
}

function renderVolunteerRow(v) {
  const flags = (v.qualification_flags || [])
    .map((f) => `${escapeHtml(f.name)}: ${f.held ? 'yes' : 'NO'}`)
    .join('; ');
  return `<tr>
    <td>${escapeHtml(v.name)}</td>
    <td>${escapeHtml(v.phone || '—')}</td>
    <td>${escapeHtml(v.emergency_contact || '—')}</td>
    <td>${escapeHtml(v.check_in_status || '—')}</td>
    <td>${flags || '—'}</td>
  </tr>`;
}

function renderShift(opp) {
  const animals = (opp.animals || []).map(renderAnimal).join('');
  const volunteers = opp.volunteers || [];
  const tableBody = volunteers.length
    ? volunteers.map(renderVolunteerRow).join('')
    : '<tr><td colspan="5">No accepted volunteers yet.</td></tr>';

  const urgent = opp.is_urgent ? ' <strong>(URGENT)</strong>' : '';

  const shiftNotes = (opp.shift_notes || [])
    .map((n) => {
      const when = n.created_at
        ? new Date(n.created_at).toLocaleString('en-GB', {
            day: 'numeric',
            month: 'short',
            hour: '2-digit',
            minute: '2-digit',
          })
        : '';
      return `<li><strong>${escapeHtml(n.author_name || 'Staff')}</strong>${
        when ? ` · ${escapeHtml(when)}` : ''
      }: ${escapeHtml(n.body)}</li>`;
    })
    .join('');

  return `
    <article class="day-sheet-shift">
      <h2>${escapeHtml(opp.title || 'Shift')}${urgent}</h2>
      <p class="day-sheet-meta">
        ${escapeHtml(formatShiftWhen(opp.start_date, opp.end_date))}
        · ${escapeHtml(opp.location || 'Location TBA')}
        · Code: <code>${escapeHtml(opp.check_in_code || '—')}</code>
        · Waitlist: ${Number(opp.waitlist_count) || 0}
        · Spots: ${volunteers.length}${
          opp.max_volunteers != null ? ` / ${opp.max_volunteers}` : ''
        }
      </p>
      ${animals ? `<div><strong>Animals</strong><ul class="day-sheet-animals">${animals}</ul></div>` : ''}
      ${
        shiftNotes
          ? `<div><strong>Shift notes</strong><ul>${shiftNotes}</ul></div>`
          : ''
      }
      <table>
        <caption>Accepted volunteers</caption>
        <thead>
          <tr>
            <th scope="col">Name</th>
            <th scope="col">Phone</th>
            <th scope="col">Emergency contact</th>
            <th scope="col">Check-in</th>
            <th scope="col">Qualifications</th>
          </tr>
        </thead>
        <tbody>${tableBody}</tbody>
      </table>
      <p><strong>Walk-in / handwritten notes</strong></p>
      <div class="day-sheet-notes" aria-hidden="true"></div>
    </article>
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
      setMessage('error', err.error || 'Unable to load day sheet.');
      if (contentEl) contentEl.innerHTML = '';
      return;
    }
    const sheet = await res.json();
    if (!sheet.opportunities?.length) {
      contentEl.innerHTML = `<p>No shifts on ${escapeHtml(sheet.date)}.</p>`;
      return;
    }
    contentEl.innerHTML = `
      <h2 class="no-print">Roster for ${escapeHtml(sheet.date)}</h2>
      ${sheet.opportunities.map(renderShift).join('')}
    `;
  } catch (error) {
    console.error('[DaySheet] load error:', error);
    setMessage('error', 'Network error loading day sheet.');
  }
}

async function init() {
  await requireAuth();
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  applyRoleVisibility(user);
  if (sheetDateInput) sheetDateInput.value = todayIso();
  loadButton?.addEventListener('click', () => loadSheet().catch(() => {}));
  printButton?.addEventListener('click', () => window.print());
  logoutButton?.addEventListener('click', () => logout());
  await loadSheet();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => console.error(err));
});
