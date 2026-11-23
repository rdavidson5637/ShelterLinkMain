import { apiRequest, API_URL } from '../config.js';
import { requireAuth, checkAuth, logout, isAdminRole } from '../auth.js';

const logoutButton = document.getElementById('logoutButton');
const messageEl = document.getElementById('message');
const volunteerUserId = document.getElementById('volunteerUserId');
const exportBtn = document.getElementById('exportBtn');
const eraseBtn = document.getElementById('eraseBtn');
const retentionBtn = document.getElementById('retentionBtn');
const retentionResult = document.getElementById('retentionResult');
const privacyContactForm = document.getElementById('privacyContactForm');
const privacyContactInput = document.getElementById('privacy_contact_email');
const privacyContactSave = document.getElementById('privacyContactSave');
const privacyContactStatus = document.getElementById('privacyContactStatus');

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

function setPrivacyStatus(text, isError = false) {
  if (!privacyContactStatus) return;
  privacyContactStatus.textContent = text || '';
  privacyContactStatus.classList.toggle('error', Boolean(isError));
}

async function loadPrivacyContact() {
  if (!privacyContactInput) return;
  try {
    const res = await apiRequest('/admin/settings/privacy-contact', { method: 'GET' });
    if (!res.ok) {
      setPrivacyStatus('Could not load the privacy contact email.', true);
      return;
    }
    const body = await res.json();
    privacyContactInput.value = body.privacy_contact_email || '';
  } catch {
    setPrivacyStatus('Could not load the privacy contact email.', true);
  }
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

  privacyContactForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (privacyContactSave) privacyContactSave.disabled = true;
    setPrivacyStatus('');
    try {
      const res = await apiRequest('/admin/settings/privacy-contact', {
        method: 'PUT',
        body: { privacy_contact_email: privacyContactInput?.value?.trim() || null },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setPrivacyStatus(body.error || 'Could not save the privacy contact email.', true);
        return;
      }
      privacyContactInput.value = body.privacy_contact_email || '';
      setPrivacyStatus(
        body.privacy_contact_email
          ? 'Privacy contact email saved.'
          : 'Privacy contact email cleared.'
      );
    } catch {
      setPrivacyStatus('Could not save the privacy contact email.', true);
    } finally {
      if (privacyContactSave) privacyContactSave.disabled = false;
    }
  });

  await loadPrivacyContact();
}

document.addEventListener('DOMContentLoaded', init);
