import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole, applyRoleVisibility } from '../auth.js';
import { formatDateOnly } from '../utils/dateFormat.js';

const messageEl = document.getElementById('message');
const tableBody = document.getElementById('noShowTableBody');
const filtersForm = document.getElementById('filtersForm');
const filterContacted = document.getElementById('filterContacted');
const filterDays = document.getElementById('filterDays');
const clearFiltersButton = document.getElementById('clearFiltersButton');
const logoutButton = document.getElementById('logoutButton');

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

function volunteerLabel(row) {
  return row.volunteer_name || row.name || row.email || `Volunteer #${row.user_id}`;
}

function followUpLabel(row) {
  if (row.no_show_followup_sent_at) {
    return `Email sent ${formatDate(row.no_show_followup_sent_at)}`;
  }
  if (row.no_show_contacted_at) {
    return `Contacted ${formatDate(row.no_show_contacted_at)}`;
  }
  return 'Not contacted';
}

function buildQuery() {
  const params = new URLSearchParams();
  if (filterContacted?.value) params.set('contacted', filterContacted.value);
  if (filterDays?.value) params.set('days', filterDays.value);
  const q = params.toString();
  return q ? `?${q}` : '';
}

function closeEmailPanels(exceptId = null) {
  if (!tableBody) return;
  tableBody.querySelectorAll('[data-email-panel]').forEach((panel) => {
    const id = panel.getAttribute('data-email-panel');
    if (exceptId != null && String(id) === String(exceptId)) return;
    panel.hidden = true;
  });
}

function renderTable(items) {
  if (!tableBody) return;
  if (!items.length) {
    tableBody.innerHTML = '<tr><td colspan="5">No no-shows match these filters</td></tr>';
    return;
  }

  tableBody.replaceChildren();
  items.forEach((item) => {
    const tr = document.createElement('tr');
    const cells = [
      volunteerLabel(item),
      item.opportunity_title || (item.opportunity_id ? `Shift #${item.opportunity_id}` : 'Shift'),
      formatDate(item.opportunity_start_date),
      followUpLabel(item),
    ];
    cells.forEach((value) => {
      const td = document.createElement('td');
      td.textContent = value;
      tr.appendChild(td);
    });

    const actionsTd = document.createElement('td');
    const actions = document.createElement('div');
    actions.className = 'no-show-actions';

    const contacted = Boolean(item.no_show_contacted_at);
    if (!contacted) {
      const markBtn = document.createElement('button');
      markBtn.type = 'button';
      markBtn.className = 'secondary';
      markBtn.textContent = 'Mark contacted';
      markBtn.addEventListener('click', () => markContacted(item.application_id || item.id, false));
      actions.appendChild(markBtn);
    }

    const emailBtn = document.createElement('button');
    emailBtn.type = 'button';
    emailBtn.textContent = item.no_show_followup_sent_at ? 'Send another email' : 'Send follow-up email';
    emailBtn.addEventListener('click', () => {
      const panel = tr.querySelector('[data-email-panel]');
      if (!panel) return;
      const opening = panel.hidden;
      closeEmailPanels(item.application_id || item.id);
      panel.hidden = !opening;
      if (!panel.hidden) {
        const area = panel.querySelector('textarea');
        area?.focus();
      }
    });
    actions.appendChild(emailBtn);

    const panel = document.createElement('div');
    panel.className = 'email-panel';
    panel.hidden = true;
    panel.setAttribute('data-email-panel', String(item.application_id || item.id));

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
      markContacted(item.application_id || item.id, true, textarea.value, sendBtn);
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

async function markContacted(applicationId, sendEmail, message = '', button = null) {
  if (button) button.disabled = true;
  try {
    const body = { send_email: Boolean(sendEmail) };
    if (sendEmail && message && String(message).trim()) {
      body.message = String(message).trim().slice(0, 2000);
    }
    const res = await apiRequest(`/applications/${applicationId}/no-show/contacted`, {
      method: 'PATCH',
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(data.error || 'Unable to update no-show follow-up.', 'error');
      if (button) button.disabled = false;
      return;
    }
    if (data.email_sent) {
      setMessage('Follow-up email sent and marked contacted.', 'success');
    } else {
      setMessage('Marked as contacted.', 'success');
    }
    await loadNoShows();
  } catch (error) {
    console.error('[AdminNoShows] markContacted error:', error);
    setMessage('Network error.', 'error');
    if (button) button.disabled = false;
  }
}

async function loadNoShows() {
  try {
    const res = await apiRequest(`/applications/no-shows${buildQuery()}`, { method: 'GET' });
    if (!res.ok) {
      tableBody.innerHTML = '<tr><td colspan="5">Failed to load no-shows</td></tr>';
      setMessage('Unable to load no-show queue.', 'error');
      return;
    }
    const data = await res.json();
    renderTable(Array.isArray(data.items) ? data.items : []);
  } catch (error) {
    console.error('[AdminNoShows] loadNoShows error:', error);
    tableBody.innerHTML = '<tr><td colspan="5">Error loading no-shows</td></tr>';
  }
}

function attachListeners() {
  filtersForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    loadNoShows();
  });

  clearFiltersButton?.addEventListener('click', () => {
    if (filterContacted) filterContacted.value = 'open';
    if (filterDays) filterDays.value = '90';
    loadNoShows();
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
  await loadNoShows();
}

document.addEventListener('DOMContentLoaded', init);
