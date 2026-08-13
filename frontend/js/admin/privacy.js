import { apiRequest, API_URL } from '../config.js';
import { requireAuth, checkAuth, logout, isAdminRole } from '../auth.js';

const logoutButton = document.getElementById('logoutButton');
const messageEl = document.getElementById('message');
const volunteerUserId = document.getElementById('volunteerUserId');
const exportBtn = document.getElementById('exportBtn');
const eraseBtn = document.getElementById('eraseBtn');
const retentionBtn = document.getElementById('retentionBtn');
const retentionResult = document.getElementById('retentionResult');

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  messageEl.innerHTML = `<p class="${cls}">${text}</p>`;
}

function readUserId() {
  const id = Number(volunteerUserId?.value);
  if (!Number.isFinite(id) || id <= 0) {
    setMessage('Enter a valid volunteer user id', 'error');
    return null;
  }
  return id;
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

  exportBtn?.addEventListener('click', () => {
    const id = readUserId();
    if (!id) return;
    window.location.href = `${API_URL}/admin/gdpr/volunteers/${id}/export`;
  });

  eraseBtn?.addEventListener('click', async () => {
    const id = readUserId();
    if (!id) return;
    const typed = window.prompt('Type DELETE to anonymise this volunteer:');
    if (typed !== 'DELETE') {
      setMessage('Erasure cancelled', 'error');
      return;
    }
    try {
      const res = await apiRequest(`/admin/gdpr/volunteers/${id}/erase`, {
        method: 'POST',
        body: { confirmation: 'DELETE' },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error || 'Erasure failed', 'error');
        return;
      }
      setMessage(
        `${body.message}. Hours preserved: ${body.hours_preserved ?? 'n/a'}`,
        'success'
      );
    } catch {
      setMessage('Network error', 'error');
    }
  });

  retentionBtn?.addEventListener('click', async () => {
    if (!window.confirm('Run data retention anonymisation now?')) return;
    try {
      const res = await apiRequest('/admin/gdpr/retention/run', { method: 'POST' });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error || 'Retention run failed', 'error');
        return;
      }
      if (retentionResult) {
        retentionResult.textContent = JSON.stringify(body, null, 2);
      }
      setMessage(
        `Retention complete — scanned ${body.scanned}, anonymised ${body.anonymised}`,
        'success'
      );
    } catch {
      setMessage('Network error', 'error');
    }
  });
}

document.addEventListener('DOMContentLoaded', init);
