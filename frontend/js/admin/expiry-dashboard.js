import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';
import { formatDateOnly } from '../utils/dateFormat.js';

const messageEl = document.getElementById('message');
const tableBody = document.getElementById('expiryTableBody');
const filtersForm = document.getElementById('filtersForm');
const filterDays = document.getElementById('filterDays');
const clearFiltersButton = document.getElementById('clearFiltersButton');
const logoutButton = document.getElementById('logoutButton');

const KIND_LABELS = {
  background_check: 'Background check',
  document: 'Document',
  qualification: 'Qualification',
};

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

function formatDate(value) {
  return formatDateOnly(value) || '—';
}

function kindLabel(kind) {
  return KIND_LABELS[kind] || kind || 'Item';
}

function reminderLabel(row) {
  if (row.last_staff_reminder_sent_at) {
    return `Email sent ${formatDate(row.last_staff_reminder_sent_at)}`;
  }
  return 'Not sent';
}

function buildQuery() {
  const params = new URLSearchParams();
  if (filterDays?.value) params.set('days', filterDays.value);
  const q = params.toString();
  return q ? `?${q}` : '';
}

function rowKey(item) {
  return `${item.kind}:${item.id}`;
}

function closeEmailPanels(exceptKey = null) {
  if (!tableBody) return;
  tableBody.querySelectorAll('[data-email-panel]').forEach((panel) => {
    const key = panel.getAttribute('data-email-panel');
    if (exceptKey != null && String(key) === String(exceptKey)) return;
    panel.hidden = true;
  });
}

function renderTable(items) {
  if (!tableBody) return;
  if (!items.length) {
    tableBody.innerHTML = '<tr><td colspan="6">Nothing expires in this window</td></tr>';
    return;
  }

  tableBody.replaceChildren();
  items.forEach((item) => {
    const tr = document.createElement('tr');
    const key = rowKey(item);

    const nameTd = document.createElement('td');
    const link = document.createElement('a');
    link.href = item.href || `/pages/admin/volunteers.html?user=${encodeURIComponent(item.user_id)}`;
    link.textContent = item.volunteer_name || `Volunteer #${item.user_id}`;
    nameTd.appendChild(link);

    const cells = [
      nameTd,
      kindLabel(item.kind),
      item.label || '—',
      formatDate(item.expires_on),
      reminderLabel(item),
    ];

    cells.forEach((value) => {
      if (value instanceof HTMLElement) {
        tr.appendChild(value);
        return;
      }
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    });

    const actionsTd = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'expiry-actions';

    const emailBtn = document.createElement('button');
    emailBtn.type = 'button';
    emailBtn.textContent = item.last_staff_reminder_sent_at
      ? 'Send another email'
      : 'Send reminder email';
    emailBtn.addEventListener('click', () => {
      const panel = tr.querySelector('[data-email-panel]');
      if (!panel) return;
      const opening = panel.hidden;
      closeEmailPanels(key);
      panel.hidden = !opening;
      if (!panel.hidden) {
        panel.querySelector('textarea')?.focus();
      }
    });
    actions.appendChild(emailBtn);

    const panel = document.createElement('div');
    panel.className = 'email-panel';
    panel.hidden = true;
    panel.setAttribute('data-email-panel', key);

    const label = document.createElement('label');
    label.textContent = 'Optional note for the volunteer';
    const textarea = document.createElement('textarea');
    textarea.maxLength = 2000;
    textarea.rows = 3;
    textarea.placeholder = 'Optional. Keep it short and factual.';
    label.appendChild(textarea);

    const rowActions = document.createElement('div');
    rowActions.className = 'row-actions';
    const sendBtn = document.createElement('button');
    sendBtn.type = 'button';
    sendBtn.textContent = 'Send email';
    sendBtn.addEventListener('click', () => {
      sendReminder(item.kind, item.id, textarea.value, sendBtn);
    });
    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'secondary';
    cancelBtn.textContent = 'Cancel';
    cancelBtn.addEventListener('click', () => {
      panel.hidden = true;
    });
    rowActions.append(sendBtn, cancelBtn);
    panel.append(label, rowActions);

    actionsTd.append(actions, panel);
    tr.appendChild(actionsTd);
    tableBody.appendChild(tr);
  });
}

async function sendReminder(kind, id, message = '', button = null) {
  if (button) button.disabled = true;
  try {
    const body = { kind, id, send_email: true };
    if (message && String(message).trim()) {
      body.message = String(message).trim().slice(0, 2000);
    }
    const res = await apiRequest('/admin/expiry-dashboard/remind', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.error || 'Unable to send reminder.', 'error');
      if (button) button.disabled = false;
      return;
    }
    setMessage('Reminder email sent.', 'success');
    await loadItems();
  } catch (error) {
    console.error('[AdminExpiry] sendReminder error:', error);
    setMessage('Network error.', 'error');
    if (button) button.disabled = false;
  }
}

async function loadItems() {
  try {
    const res = await apiRequest(`/admin/expiry-dashboard${buildQuery()}`, { method: 'GET' });
    if (!res.ok) {
      tableBody.innerHTML = '<tr><td colspan="6">Failed to load expiry list</td></tr>';
      setMessage('Unable to load expiring items.', 'error');
      return;
    }
    const data = await res.json();
    renderTable(Array.isArray(data.items) ? data.items : []);
  } catch (error) {
    console.error('[AdminExpiry] loadItems error:', error);
    tableBody.innerHTML = '<tr><td colspan="6">Error loading expiry list</td></tr>';
  }
}

function attachListeners() {
  filtersForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    loadItems();
  });

  clearFiltersButton?.addEventListener('click', () => {
    if (filterDays) filterDays.value = '30';
    loadItems();
  });

  logoutButton?.addEventListener('click', () => logout());
}

async function init() {
  await requireAuth();
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/error/403.html';
    return;
  }
  applyRoleVisibility(user);
  attachListeners();
  await loadItems();
}

document.addEventListener('DOMContentLoaded', init);
