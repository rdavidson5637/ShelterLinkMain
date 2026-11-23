import { apiRequest, API_URL } from '../config.js';
import { requireAuth, checkAuth, logout, isAdminRole } from '../auth.js';

const logoutButton = document.getElementById('logoutButton');
const messageEl = document.getElementById('message');
const volunteerUserId = document.getElementById('volunteerUserId');
const exportBtn = document.getElementById('exportBtn');
const eraseBtn = document.getElementById('eraseBtn');
const retentionBtn = document.getElementById('retentionBtn');
const retentionPreviewBtn = document.getElementById('retentionPreviewBtn');
const retentionResult = document.getElementById('retentionResult');
const privacyContactForm = document.getElementById('privacyContactForm');
const privacyContactInput = document.getElementById('privacy_contact_email');
const privacyContactSave = document.getElementById('privacyContactSave');
const privacyContactStatus = document.getElementById('privacyContactStatus');
const retentionMonths = document.getElementById('retentionMonths');
const retentionSettingsForm = document.getElementById('retentionSettingsForm');
const retentionStatus = document.getElementById('retentionStatus');
const retentionPreviewWrap = document.getElementById('retentionPreviewWrap');
const retentionPreviewMeta = document.getElementById('retentionPreviewMeta');
const retentionPreviewList = document.getElementById('retentionPreviewList');

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

function describeSettings(settings) {
  const months = settings?.retention_inactive_months;
  if (months == null) {
    return 'Retention is off for this shelter. The daily job will not anonymise anyone here.';
  }
  return `Retention is on: volunteers inactive for ${months} month${months === 1 ? '' : 's'} are eligible.`;
}

function renderPreview(preview) {
  if (!retentionPreviewWrap || !retentionPreviewList || !retentionPreviewMeta) return;
  retentionPreviewWrap.hidden = false;
  retentionPreviewList.replaceChildren();

  if (preview.skipped || preview.retention_inactive_months == null) {
    retentionPreviewMeta.textContent =
      'No retention period is set for this shelter. Save a period above, then preview again.';
    return;
  }

  const count = Array.isArray(preview.candidates) ? preview.candidates.length : 0;
  retentionPreviewMeta.textContent =
    count === 0
      ? `No volunteers inactive for ${preview.retention_inactive_months} months (cutoff ${preview.cutoff || 'n/a'}).`
      : `${count} volunteer${count === 1 ? '' : 's'} would be anonymised (cutoff ${preview.cutoff || 'n/a'}).`;

  for (const row of preview.candidates || []) {
    const li = document.createElement('li');
    const title = document.createElement('strong');
    title.textContent = row.name || `${row.first_name || ''} ${row.last_name || ''}`.trim() || `User ${row.user_id}`;
    const detail = document.createElement('p');
    detail.textContent = `User ${row.user_id} · ${row.email || 'no email'} · inactive since ${row.inactive_since || row.last_login || row.created_at || 'unknown'}`;
    li.append(title, detail);
    retentionPreviewList.appendChild(li);
  }
}

async function loadRetentionSettings() {
  const res = await apiRequest('/admin/settings/retention');
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    if (retentionStatus) {
      retentionStatus.textContent = body.error || 'Could not load retention settings';
    }
    return null;
  }
  if (retentionMonths) {
    retentionMonths.value =
      body.retention_inactive_months == null ? '' : String(body.retention_inactive_months);
  }
  if (retentionStatus) {
    retentionStatus.textContent = describeSettings(body);
  }
  return body;
}

async function loadPreview() {
  const res = await apiRequest('/admin/gdpr/retention/preview');
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    setMessage(body.error || 'Preview failed', 'error');
    return null;
  }
  renderPreview(body);
  return body;
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

  retentionSettingsForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const raw = retentionMonths?.value;
    const retention_inactive_months =
      raw == null || String(raw).trim() === '' ? null : Number(raw);
    try {
      const res = await apiRequest('/admin/settings/retention', {
        method: 'PUT',
        body: { retention_inactive_months },
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(body.error || 'Could not save retention settings', 'error');
        return;
      }
      if (retentionStatus) {
        retentionStatus.textContent = describeSettings(body);
      }
      setMessage('Retention period saved', 'success');
      await loadPreview();
    } catch {
      setMessage('Network error', 'error');
    }
  });

  retentionPreviewBtn?.addEventListener('click', async () => {
    try {
      const preview = await loadPreview();
      if (preview) {
        setMessage(
          preview.skipped
            ? 'Retention is off — nothing to preview'
            : `Preview ready (${preview.scanned} candidate${preview.scanned === 1 ? '' : 's'})`,
          'success'
        );
      }
    } catch {
      setMessage('Network error', 'error');
    }
  });

  retentionBtn?.addEventListener('click', async () => {
    try {
      const preview = await loadPreview();
      if (!preview) return;
      if (preview.skipped) {
        setMessage('Retention is off for this shelter. Save a period first.', 'error');
        return;
      }
      const count = preview.scanned || 0;
      const label =
        count === 0
          ? 'Run data retention now? The preview list is empty, so nothing should change.'
          : `Anonymise ${count} inactive volunteer${count === 1 ? '' : 's'} now? Approved hours are kept.`;
      if (!window.confirm(label)) return;

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
        body.skipped
          ? 'Retention skipped — no period is set for this shelter'
          : `Retention complete — scanned ${body.scanned}, anonymised ${body.anonymised}`,
        'success'
      );
      await loadPreview();
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

  try {
    await loadRetentionSettings();
    await loadPreview();
  } catch {
    // Settings load is best-effort; the form still works.
  }
}

document.addEventListener('DOMContentLoaded', init);
