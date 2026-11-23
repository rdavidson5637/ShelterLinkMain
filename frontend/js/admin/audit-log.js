import { API_URL, apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isAdminRole } from '../auth.js';
import { formatShiftWhen } from '../utils/dateFormat.js';

const PAGE_SIZE = 50;

const logoutButton = document.getElementById('logoutButton');
const filterForm = document.getElementById('filterForm');
const auditTableBody = document.getElementById('auditTableBody');
const messageEl = document.getElementById('message');
const pagerEl = document.getElementById('auditPager');
const pageStatusEl = document.getElementById('auditPageStatus');
const prevPageButton = document.getElementById('prevPageButton');
const nextPageButton = document.getElementById('nextPageButton');
const exportCsvButton = document.getElementById('exportCsvButton');
const auditTableHead = document.getElementById('auditTableHead');

let offset = 0;
let total = 0;
let scope = 'shelter';

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  const note = document.createElement('p');
  if (cls) note.className = cls;
  note.textContent = text;
  messageEl.replaceChildren(note);
}

function formatWhen(value) {
  if (!value) return '—';
  return formatShiftWhen(value);
}

function actorLabel(row) {
  const name = `${row.actor_first_name || ''} ${row.actor_last_name || ''}`.trim();
  if (name && row.actor_email) return `${name} (${row.actor_email})`;
  return row.actor_email || (row.user_id != null ? `User #${row.user_id}` : 'System');
}

function targetLabel(row) {
  return [row.entity_type, row.entity_id].filter(Boolean).join(' #');
}

function detailLabel(row) {
  if (row.detail_json == null) return '';
  if (typeof row.detail_json === 'string') return row.detail_json;
  return JSON.stringify(row.detail_json);
}

function shelterLabel(row) {
  if (row.shelter_name) return row.shelter_name;
  if (row.shelter_id != null) return `Shelter #${row.shelter_id}`;
  return '—';
}

function currentFilters() {
  const params = new URLSearchParams();
  const action = document.getElementById('filterAction')?.value?.trim();
  const entityType = document.getElementById('filterEntityType')?.value?.trim();
  const userId = document.getElementById('filterUserId')?.value?.trim();
  const from = document.getElementById('filterFrom')?.value;
  const to = document.getElementById('filterTo')?.value;
  if (action) params.set('action', action);
  if (entityType) params.set('entityType', entityType);
  if (userId) params.set('userId', userId);
  if (from) params.set('from', `${from} 00:00:00`);
  if (to) params.set('to', `${to} 23:59:59`);
  return params;
}

function updateTableHead() {
  if (!auditTableHead) return;
  const labels = scope === 'all'
    ? ['When', 'Who', 'What', 'Target', 'Shelter', 'Detail']
    : ['When', 'Who', 'What', 'Target', 'Detail'];
  auditTableHead.replaceChildren();
  labels.forEach((label) => {
    const th = document.createElement('th');
    th.scope = 'col';
    th.textContent = label;
    auditTableHead.appendChild(th);
  });
}

function updatePager() {
  if (!pagerEl || !pageStatusEl) return;
  const start = total === 0 ? 0 : offset + 1;
  const end = Math.min(offset + PAGE_SIZE, total);
  pageStatusEl.textContent = total
    ? `Showing ${start}–${end} of ${total}`
    : 'No matching rows';
  if (prevPageButton) prevPageButton.disabled = offset <= 0;
  if (nextPageButton) nextPageButton.disabled = offset + PAGE_SIZE >= total;
  pagerEl.hidden = false;
}

function renderRows(rows) {
  if (!auditTableBody) return;
  const colCount = scope === 'all' ? 6 : 5;
  if (!Array.isArray(rows) || !rows.length) {
    auditTableBody.innerHTML = `<tr><td colspan="${colCount}">No matching audit rows</td></tr>`;
    return;
  }
  auditTableBody.innerHTML = '';
  rows.forEach((row) => {
    const tr = document.createElement('tr');
    const cells = [formatWhen(row.created_at), actorLabel(row), row.action || '', targetLabel(row)];
    if (scope === 'all') cells.push(shelterLabel(row));
    cells.push(detailLabel(row).slice(0, 240));
    cells.forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    });
    auditTableBody.appendChild(tr);
  });
}

async function loadAudit() {
  if (!auditTableBody) return;
  const params = currentFilters();
  params.set('limit', String(PAGE_SIZE));
  params.set('offset', String(offset));

  try {
    const res = await apiRequest(`/admin/audit-log?${params.toString()}`, { method: 'GET' });
    if (!res.ok) {
      auditTableBody.innerHTML = '<tr><td colspan="6">Failed to load audit log</td></tr>';
      setMessage('Could not load the audit log.', 'error');
      return;
    }
    const body = await res.json();
    const rows = Array.isArray(body) ? body : body.rows;
    total = Array.isArray(body) ? rows.length : Number(body.total) || 0;
    scope = Array.isArray(body) ? 'shelter' : body.scope || 'shelter';
    updateTableHead();
    renderRows(rows);
    updatePager();
    setMessage('');
  } catch (err) {
    console.error(err);
    auditTableBody.innerHTML = '<tr><td colspan="6">Error loading audit log</td></tr>';
    setMessage('Error loading audit log.', 'error');
  }
}

function exportCsv() {
  const params = currentFilters();
  window.location.href = `${API_URL}/admin/audit-log.csv?${params.toString()}`;
}

async function init() {
  await requireAuth();
  const user = await checkAuth();
  if (!isAdminRole(user)) {
    window.location.href = '/login.html';
    return;
  }
  logoutButton?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });
  filterForm?.addEventListener('submit', (e) => {
    e.preventDefault();
    offset = 0;
    loadAudit();
  });
  prevPageButton?.addEventListener('click', () => {
    offset = Math.max(0, offset - PAGE_SIZE);
    loadAudit();
  });
  nextPageButton?.addEventListener('click', () => {
    offset += PAGE_SIZE;
    loadAudit();
  });
  exportCsvButton?.addEventListener('click', (e) => {
    e.preventDefault();
    exportCsv();
  });
  await loadAudit();
}

document.addEventListener('DOMContentLoaded', init);
