import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isStaffOrAdminRole } from '../auth.js';
import { formatShiftWhen } from '../utils/dateFormat.js';
import { createStatusBadge } from '../components/statusBadge.js';
import { escapeHtml } from '../utils/escapeHtml.js';

const logoutButton = document.getElementById('logoutButton');
const statusFilter = document.getElementById('statusFilter');
const tableBody = document.getElementById('bookingsTableBody');
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

function formatDate(value) {
  if (!value) return '';
  return formatShiftWhen(value);
}

async function loadBookings() {
  if (!tableBody) return;
  const status = statusFilter?.value || 'pending';
  const query = status === 'all' ? '' : `?status=${encodeURIComponent(status)}`;
  try {
    const res = await apiRequest(`/group-bookings${query}`, { method: 'GET' });
    if (!res.ok) {
      tableBody.innerHTML = '<tr><td colspan="6">Failed to load bookings</td></tr>';
      return;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      tableBody.innerHTML = '<tr><td colspan="6">No group bookings</td></tr>';
      return;
    }

    tableBody.innerHTML = '';
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>
          <strong>${escapeHtml(row.group_name || '')}</strong>
          ${row.notes ? `<br/><small>${escapeHtml(row.notes)}</small>` : ''}
        </td>
        <td>
          ${escapeHtml(row.opportunity_title || 'Opportunity')}<br/>
          <small>${escapeHtml(formatDate(row.opportunity_start_date))}</small>
        </td>
        <td>
          ${escapeHtml(row.contact_name || '')}<br/>
          <small>${escapeHtml(row.contact_email || '')}</small>
        </td>
        <td>${escapeHtml(row.size)}</td>
        <td class="status-cell"></td>
        <td class="actions-cell"></td>
      `;
      const statusCell = tr.querySelector('.status-cell');
      statusCell.appendChild(createStatusBadge(row.status));
      const actions = tr.querySelector('.actions-cell');
      if (row.status === 'pending') {
        const confirmBtn = document.createElement('button');
        confirmBtn.type = 'button';
        confirmBtn.textContent = 'Confirm';
        confirmBtn.classList.add('button-small');
        confirmBtn.addEventListener('click', () => act(row.id, 'confirm'));

        const declineBtn = document.createElement('button');
        declineBtn.type = 'button';
        declineBtn.textContent = 'Decline';
        declineBtn.classList.add('secondary', 'button-secondary', 'button-small');
        declineBtn.addEventListener('click', () => act(row.id, 'decline'));

        actions.appendChild(confirmBtn);
        actions.appendChild(declineBtn);
      } else {
        actions.textContent = '—';
      }
      tableBody.appendChild(tr);
    });
  } catch (error) {
    console.error('[Admin] group bookings load error:', error);
    tableBody.innerHTML = '<tr><td colspan="6">Network error</td></tr>';
  }
}

async function act(id, action) {
  setMessage('');
  try {
    const res = await apiRequest(`/group-bookings/${id}/${action}`, { method: 'POST' });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setMessage(body.error || `Failed to ${action}`, 'error');
      return;
    }
    setMessage(`Booking ${action === 'confirm' ? 'confirmed' : 'declined'}.`, 'success');
    await loadBookings();
  } catch (error) {
    console.error('[Admin] group booking action error:', error);
    setMessage('Network error', 'error');
  }
}

async function init() {
  await requireAuth();
  const user = await checkAuth();
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/login.html';
    return;
  }

  if (logoutButton) {
    logoutButton.addEventListener('click', (event) => {
      event.preventDefault();
      logout();
    });
  }
  if (statusFilter) {
    statusFilter.addEventListener('change', loadBookings);
  }
  await loadBookings();
}

document.addEventListener('DOMContentLoaded', init);
