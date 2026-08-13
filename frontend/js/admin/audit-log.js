import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isAdminRole } from '../auth.js';

const logoutButton = document.getElementById('logoutButton');
const filterForm = document.getElementById('filterForm');
const auditTableBody = document.getElementById('auditTableBody');
const messageEl = document.getElementById('message');

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  messageEl.innerHTML = `<p class="${cls}">${text}</p>`;
}

function formatWhen(value) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
}

function actorLabel(row) {
  const name = `${row.actor_first_name || ''} ${row.actor_last_name || ''}`.trim();
  if (name && row.actor_email) return `${name} (${row.actor_email})`;
  return row.actor_email || (row.user_id != null ? `User #${row.user_id}` : 'System');
}

async function loadAudit() {
  if (!auditTableBody) return;
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
  params.set('limit', '200');

  try {
    const res = await apiRequest(`/admin/audit-log?${params.toString()}`, { method: 'GET' });
    if (!res.ok) {
      auditTableBody.innerHTML = '<tr><td colspan="5">Failed to load audit log</td></tr>';
      return;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      auditTableBody.innerHTML = '<tr><td colspan="5">No matching audit rows</td></tr>';
      return;
    }
    auditTableBody.innerHTML = '';
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      const detail =
        row.detail_json == null
          ? ''
          : typeof row.detail_json === 'string'
            ? row.detail_json
            : JSON.stringify(row.detail_json);
      tr.innerHTML = `
        <td>${formatWhen(row.created_at)}</td>
        <td>${actorLabel(row)}</td>
        <td><code>${row.action || ''}</code></td>
        <td>${[row.entity_type, row.entity_id].filter(Boolean).join(' #')}</td>
        <td><small>${detail.slice(0, 240)}</small></td>
      `;
      auditTableBody.appendChild(tr);
    });
  } catch (err) {
    console.error(err);
    auditTableBody.innerHTML = '<tr><td colspan="5">Error loading audit log</td></tr>';
  }
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
    loadAudit();
  });
  await loadAudit();
}

document.addEventListener('DOMContentLoaded', init);
