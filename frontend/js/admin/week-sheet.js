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
const copyForm = document.getElementById('weekCopyForm');
const copySourceInput = document.getElementById('copySourceWeek');
const copyTargetInput = document.getElementById('copyTargetWeek');
const copyMessageEl = document.getElementById('weekCopyMessage');
const copyPreviewEl = document.getElementById('weekCopyPreview');

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
    ? `<img class="animal-thumb" src="/api/animals/${Number(a.id)}/photo" alt="" aria-hidden="true" width="40" height="40" />`
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

function coverageLabel(row) {
  if (!row || row.level === 'none') return 'No shifts';
  if (row.capped_shifts === 0) {
    return `${row.filled} booked · no capacity set`;
  }
  return `${row.filled} filled · ${row.open} open of ${row.capacity}`;
}

function weekdayShort(dateIso) {
  const d = new Date(`${dateIso}T12:00:00`);
  return d.toLocaleDateString('en-GB', { weekday: 'short' });
}

function renderCoverageDayCell(day) {
  const level = day.level || 'none';
  return `<th scope="col" class="coverage-heat-cell is-${escapeHtml(level)}">
    <span class="coverage-heat-day">${escapeHtml(weekdayShort(day.date))}</span>
    <span class="coverage-heat-level">${escapeHtml(day.level_label || 'Coverage')}</span>
    <span class="coverage-heat-counts">${escapeHtml(coverageLabel(day))}</span>
  </th>`;
}

function renderCoverageRoleRow(role) {
  return `<tr class="coverage-role-row is-${escapeHtml(role.level || 'none')}">
    <th scope="row">${escapeHtml(role.title)}</th>
    <td>${escapeHtml(role.level_label || '')}</td>
    <td>${escapeHtml(coverageLabel(role))}</td>
    <td>${Number(role.shift_count) || 0}</td>
  </tr>`;
}

function renderCoverage(coverage) {
  if (!coverage) return '';
  const days = coverage.days || [];
  const roles = coverage.roles || [];
  const week = coverage.week || {};
  const roleBody = roles.length
    ? roles.map(renderCoverageRoleRow).join('')
    : '<tr><td colspan="4">No shifts this week.</td></tr>';
  return `
    <section class="coverage-heat no-print" aria-labelledby="coverageHeatHeading">
      <header class="coverage-heat-header">
        <h2 id="coverageHeatHeading">Coverage this week</h2>
        <p>
          Open places against filled bookings from the rota.
          ${escapeHtml(week.level_label || '')}: ${escapeHtml(coverageLabel(week))}.
        </p>
      </header>
      <table class="coverage-heat-table">
        <caption class="visually-hidden">Fill level for each day of the week</caption>
        <thead>
          <tr>${days.map(renderCoverageDayCell).join('')}</tr>
        </thead>
      </table>
      <h3 class="coverage-roles-heading">By shift title</h3>
      <p class="coverage-roles-lede">Shift titles are the roles on the rota. Sorted with the most open places first.</p>
      <table class="coverage-roles-table">
        <caption class="visually-hidden">Open slots by shift title</caption>
        <thead>
          <tr>
            <th scope="col">Shift</th>
            <th scope="col">Status</th>
            <th scope="col">Places</th>
            <th scope="col">Shifts</th>
          </tr>
        </thead>
        <tbody>${roleBody}</tbody>
      </table>
    </section>
  `;
}

function renderDay(day, dayCoverage) {
  const shifts = day.opportunities || [];
  const body = shifts.length
    ? shifts.map(renderShift).join('')
    : '<p>No shifts this day.</p>';
  const coverNote = dayCoverage
    ? `<p class="week-sheet-day-coverage">${escapeHtml(dayCoverage.level_label)} — ${escapeHtml(
        coverageLabel(dayCoverage)
      )}</p>`
    : '';
  return `
    <section class="week-sheet-day">
      <h2>${escapeHtml(formatDayHeading(day.date))}</h2>
      ${coverNote}
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
    const coverageByDate = new Map(
      (sheet.coverage?.days || []).map((d) => [d.date, d])
    );
    contentEl.innerHTML = `
      <h2 class="no-print">Week of ${escapeHtml(sheet.week_start)} – ${escapeHtml(
        sheet.week_end
      )} (${total} shift${total === 1 ? '' : 's'})</h2>
      ${renderCoverage(sheet.coverage)}
      ${(sheet.days || [])
        .map((day) => renderDay(day, coverageByDate.get(day.date)))
        .join('')}
    `;
  } catch (error) {
    console.error('[WeekSheet] load error:', error);
    setMessage('error', 'Network error loading week sheet.');
  }
}

// ---- Copy a week (SL-LATER-31) -------------------------------------------

function addDaysIso(isoDate, days) {
  const d = new Date(`${isoDate}T12:00:00`);
  d.setDate(d.getDate() + days);
  return toIsoDateLocal(d);
}

function setCopyMessage(type, text) {
  if (!copyMessageEl) return;
  if (!text) {
    copyMessageEl.replaceChildren();
    return;
  }
  const note = document.createElement('p');
  note.className = type === 'error' ? 'error-message' : 'success-message';
  note.textContent = text;
  copyMessageEl.replaceChildren(note);
}

function copyWeeks() {
  const source = copySourceInput?.value ? mondayOf(copySourceInput.value) : '';
  const target = copyTargetInput?.value ? mondayOf(copyTargetInput.value) : '';
  if (copySourceInput && source) copySourceInput.value = source;
  if (copyTargetInput && target) copyTargetInput.value = target;
  return { source, target };
}

function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function renderCopyRow(row) {
  const animals = row.animals.length
    ? row.animals.map((a) => escapeHtml(a.name)).join(', ')
    : '—';
  const needs = row.qualifications.map((q) => escapeHtml(q.name));
  if (row.required_background_check_type) {
    needs.push(`Check: ${escapeHtml(row.required_background_check_type)}`);
  }
  const result =
    row.action === 'create'
      ? '<span class="badge badge--open">Create</span>'
      : `<span class="badge badge--neutral">Skip</span><span class="reason">${escapeHtml(
          row.skip_reason || ''
        )}</span>`;
  return `<tr class="${row.action === 'create' ? 'is-create' : 'is-skip'}">
    <td>${escapeHtml(formatShiftWhen(row.start_date, row.end_date))}</td>
    <td>${escapeHtml(row.title || 'Shift')}${
      row.location ? `<span class="reason">${escapeHtml(row.location)}</span>` : ''
    }</td>
    <td>${row.max_volunteers != null ? Number(row.max_volunteers) : '—'}</td>
    <td>${animals}</td>
    <td>${needs.length ? needs.join(', ') : '—'}</td>
    <td>${result}</td>
  </tr>`;
}

function renderCopyPreview(plan) {
  if (!copyPreviewEl) return;
  const { counts } = plan;
  if (!counts.source) {
    copyPreviewEl.innerHTML = `<p class="week-copy-summary">No shifts in the week of ${escapeHtml(
      plan.source_week
    )}. Nothing to copy.</p>`;
    return;
  }
  const summary = `${plural(counts.create, 'shift')} to create in the week of ${escapeHtml(
    plan.target_week
  )}${counts.skip ? `, ${counts.skip} skipped as already there` : ''}.`;
  const confirm = counts.create
    ? `<button type="button" id="copyConfirmButton">Create ${plural(counts.create, 'shift')}</button>`
    : '';
  copyPreviewEl.innerHTML = `
    <p class="week-copy-summary">${summary}</p>
    <table class="week-copy-table">
      <caption>Copy from ${escapeHtml(plan.source_week)} to ${escapeHtml(plan.target_week)}</caption>
      <thead>
        <tr>
          <th scope="col">New time</th>
          <th scope="col">Shift</th>
          <th scope="col">Spots</th>
          <th scope="col">Animals</th>
          <th scope="col">Requires</th>
          <th scope="col">Result</th>
        </tr>
      </thead>
      <tbody>${plan.rows.map(renderCopyRow).join('')}</tbody>
    </table>
    <div class="week-copy-actions">
      ${confirm}
      <button type="button" id="copyCancelButton" class="secondary">Cancel</button>
    </div>
  `;
  document
    .getElementById('copyConfirmButton')
    ?.addEventListener('click', () => confirmCopy(plan.source_week, plan.target_week));
  document.getElementById('copyCancelButton')?.addEventListener('click', () => {
    copyPreviewEl.replaceChildren();
    setCopyMessage();
  });
}

async function previewCopy() {
  const { source, target } = copyWeeks();
  setCopyMessage();
  if (!source || !target) {
    setCopyMessage('error', 'Pick both weeks.');
    return;
  }
  if (copyPreviewEl) copyPreviewEl.innerHTML = '<p>Loading preview…</p>';
  try {
    const res = await apiRequest(
      `/admin/week-sheet/copy-preview?source_week=${encodeURIComponent(
        source
      )}&target_week=${encodeURIComponent(target)}`
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      copyPreviewEl?.replaceChildren();
      setCopyMessage('error', body.error || 'Unable to preview the copy.');
      return;
    }
    renderCopyPreview(body);
  } catch (error) {
    console.error('[WeekSheet] copy preview error:', error);
    copyPreviewEl?.replaceChildren();
    setCopyMessage('error', 'Network error loading the preview.');
  }
}

async function confirmCopy(source, target) {
  const button = document.getElementById('copyConfirmButton');
  if (button) {
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
  }
  try {
    const res = await apiRequest('/admin/week-sheet/copy', {
      method: 'POST',
      body: { source_week: source, target_week: target },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setCopyMessage('error', body.error || 'Unable to copy the week.');
      if (button) {
        button.disabled = false;
        button.removeAttribute('aria-busy');
      }
      return;
    }
    copyPreviewEl?.replaceChildren();
    const skipped = body.counts?.skip || 0;
    setCopyMessage(
      'success',
      `Created ${plural(body.counts?.create || 0, 'shift')} in the week of ${target}${
        skipped ? `; skipped ${skipped}` : ''
      }.`
    );
    if (weekStartInput) weekStartInput.value = target;
    await loadSheet();
  } catch (error) {
    console.error('[WeekSheet] copy error:', error);
    setCopyMessage('error', 'Network error copying the week.');
    if (button) {
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
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
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get('week_start');
  const initialWeek =
    fromQuery && /^\d{4}-\d{2}-\d{2}$/.test(fromQuery)
      ? mondayOf(fromQuery)
      : todayMonday();
  if (weekStartInput) weekStartInput.value = initialWeek;
  updateIcsLink(weekStartInput?.value || initialWeek);
  loadButton?.addEventListener('click', () => loadSheet().catch(() => {}));
  printButton?.addEventListener('click', () => window.print());
  weekStartInput?.addEventListener('change', () => {
    if (!weekStartInput.value) return;
    weekStartInput.value = mondayOf(weekStartInput.value);
    updateIcsLink(weekStartInput.value);
  });
  logoutButton?.addEventListener('click', () => logout());
  if (copySourceInput) copySourceInput.value = initialWeek;
  if (copyTargetInput) copyTargetInput.value = addDaysIso(initialWeek, 7);
  copyForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    previewCopy().catch(() => {});
  });
  await loadSheet();
}

document.addEventListener('DOMContentLoaded', () => {
  init().catch((err) => console.error(err));
});
