import { apiRequest } from '../config.js';
import { requireAuth, checkAuth, logout, isAdminRole} from '../auth.js';
import { escapeHtml } from '../utils/escapeHtml.js';

const form = document.getElementById('messageForm');
const messageEl = document.getElementById('message');
const recipientCountEl = document.getElementById('recipientCount');
const historyTableBody = document.getElementById('historyTableBody');
const logoutButton = document.getElementById('logoutButton');
const sendButton = document.getElementById('sendButton');

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  messageEl.innerHTML = `<p class="${cls}">${text}</p>`;
}

function getFilter() {
  return {
    profileStatus: document.getElementById('profileStatus')?.value || '',
    skill: document.getElementById('skill')?.value || '',
    minApprovedHours: document.getElementById('minApprovedHours')?.value || '',
    opportunityId: document.getElementById('opportunityId')?.value || '',
  };
}

async function refreshRecipientCount() {
  const filter = getFilter();
  const params = new URLSearchParams();
  Object.entries(filter).forEach(([key, value]) => {
    if (value !== '' && value != null) params.set(key, value);
  });
  try {
    const res = await apiRequest(`/admin/messages/recipients?${params.toString()}`, { method: 'GET' });
    if (!res.ok) {
      if (recipientCountEl) recipientCountEl.textContent = '?';
      return 0;
    }
    const data = await res.json();
    const count = Number(data.count || 0);
    if (recipientCountEl) recipientCountEl.textContent = String(count);
    return count;
  } catch (error) {
    console.error('[Admin] recipient count error:', error);
    if (recipientCountEl) recipientCountEl.textContent = '?';
    return 0;
  }
}

async function loadHistory() {
  if (!historyTableBody) return;
  try {
    const res = await apiRequest('/admin/messages', { method: 'GET' });
    if (!res.ok) {
      historyTableBody.innerHTML = '<tr><td colspan="4">Failed to load history</td></tr>';
      return;
    }
    const rows = await res.json();
    if (!Array.isArray(rows) || !rows.length) {
      historyTableBody.innerHTML = '<tr><td colspan="4">No messages sent yet</td></tr>';
      return;
    }
    historyTableBody.innerHTML = '';
    rows.forEach((row) => {
      const tr = document.createElement('tr');
      const when = row.created_at ? new Date(row.created_at).toLocaleString() : '';
      const admin = `${row.first_name || ''} ${row.last_name || ''}`.trim() || row.admin_email || 'Admin';
      tr.innerHTML = `
        <td>${escapeHtml(when)}</td>
        <td>${escapeHtml(row.subject || '')}</td>
        <td>${escapeHtml(row.recipient_count || 0)}</td>
        <td>${escapeHtml(admin)}</td>
      `;
      historyTableBody.appendChild(tr);
    });
  } catch (error) {
    console.error('[Admin] message history error:', error);
    historyTableBody.innerHTML = '<tr><td colspan="4">Network error</td></tr>';
  }
}

async function handleSubmit(event) {
  event.preventDefault();
  setMessage();
  const filter = getFilter();
  const subject = document.getElementById('subject')?.value?.trim();
  const body = document.getElementById('body')?.value?.trim();
  const count = await refreshRecipientCount();

  if (!count) {
    setMessage('No recipients match these filters.', 'error');
    return;
  }

  const confirmed = window.confirm(`Send this message to ${count} volunteer${count === 1 ? '' : 's'}?`);
  if (!confirmed) return;

  sendButton?.setAttribute('disabled', 'true');
  try {
    const res = await apiRequest('/admin/messages', {
      method: 'POST',
      body: { subject, body, filter },
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage(err?.error || 'Failed to send message.', 'error');
      return;
    }
    const data = await res.json();
    setMessage(`Sent ${data.sent} message(s)${data.failed ? `, ${data.failed} failed` : ''}.`, 'success');
    form?.reset();
    await refreshRecipientCount();
    await loadHistory();
  } catch (error) {
    console.error('[Admin] send message error:', error);
    setMessage('Network error while sending.', 'error');
  } finally {
    sendButton?.removeAttribute('disabled');
  }
}

async function init() {
  await requireAuth();
  const user = await checkAuth();
  if (!user || user.role !== 'admin') {
    window.location.href = '/login.html';
    return;
  }

  ['profileStatus', 'skill', 'minApprovedHours', 'opportunityId'].forEach((id) => {
    document.getElementById(id)?.addEventListener('change', refreshRecipientCount);
    document.getElementById(id)?.addEventListener('input', () => {
      clearTimeout(window.__msgCountTimer);
      window.__msgCountTimer = setTimeout(refreshRecipientCount, 300);
    });
  });

  form?.addEventListener('submit', handleSubmit);
  logoutButton?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });

  await refreshRecipientCount();
  await loadHistory();
}

document.addEventListener('DOMContentLoaded', init);
