import { apiRequest } from '../config.js';
import { requireAuth, logout, isStaffOrAdminRole } from '../auth.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { showConfirm } from '../components/confirmDialog.js';

const messageEl = document.getElementById('message');
const listEl = document.getElementById('announcementList');
const form = document.getElementById('announcementForm');
const showArchivedEl = document.getElementById('showArchived');
const logoutButton = document.getElementById('logoutButton');

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  messageEl.textContent = text || '';
  messageEl.dataset.tone = tone;
}

function formatDate(value) {
  if (!value) return '';
  const text = String(value).slice(0, 10);
  return text;
}

function renderItems(items) {
  if (!listEl) return;
  if (!items.length) {
    listEl.innerHTML = '<p class="announcement-empty">No notices yet.</p>';
    return;
  }

  listEl.innerHTML = `<ul class="announcement-ruled-list">${items
    .map((item) => {
      const status = escapeHtml(item.status || 'active');
      const posted = formatDate(item.posted_on);
      const expires = formatDate(item.expires_on);
      const emailed = item.emailed_at
        ? `Emailed ${escapeHtml(String(item.email_count || 0))} on ${escapeHtml(
            String(item.emailed_at).slice(0, 10)
          )}`
        : 'Not emailed';
      const canAct = item.status === 'active';
      return `<li data-id="${item.id}">
        <div class="announcement-ruled-main">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.body)}</p>
          <p class="announcement-meta">
            Posted ${escapeHtml(posted)}${
              expires ? ` · Expires ${escapeHtml(expires)}` : ''
            }
            · ${status}
            · ${emailed}
          </p>
        </div>
        <div class="announcement-ruled-actions">
          ${
            canAct
              ? `<button type="button" class="secondary" data-action="email">Email active volunteers</button>
                 <button type="button" class="secondary" data-action="archive">Archive</button>`
              : item.status === 'expired' && !item.archived_at
                ? `<button type="button" class="secondary" data-action="archive">Archive</button>`
                : ''
          }
        </div>
      </li>`;
    })
    .join('')}</ul>`;
}

async function loadList() {
  const showArchived = Boolean(showArchivedEl?.checked);
  const query = showArchived ? '?all=1' : '';
  const res = await apiRequest(`/announcements${query}`, { method: 'GET' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not load announcements');
  }
  const data = await res.json();
  renderItems(Array.isArray(data.items) ? data.items : []);
}

async function onSubmit(event) {
  event.preventDefault();
  const title = document.getElementById('announcement_title')?.value?.trim() || '';
  const body = document.getElementById('announcement_body')?.value?.trim() || '';
  const posted_on = document.getElementById('announcement_posted_on')?.value || '';
  const expires_on = document.getElementById('announcement_expires_on')?.value || '';

  const payload = { title, body };
  if (posted_on) payload.posted_on = posted_on;
  if (expires_on) payload.expires_on = expires_on;

  const res = await apiRequest('/announcements', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    setMessage(err.error || 'Could not post notice', 'error');
    return;
  }
  form?.reset();
  setMessage('Notice posted. Volunteers will see it on home. Email is optional.', 'success');
  await loadList();
}

async function onListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button || !listEl?.contains(button)) return;
  const row = button.closest('li[data-id]');
  const id = row?.getAttribute('data-id');
  if (!id) return;
  const action = button.getAttribute('data-action');

  if (action === 'archive') {
    const ok = await showConfirm({
      title: 'Archive this notice?',
      message: 'Volunteers will no longer see it on home. You can still find it under Show archived.',
      confirmLabel: 'Archive',
    });
    if (!ok) return;
    const res = await apiRequest(`/announcements/${id}/archive`, { method: 'POST' });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      setMessage(err.error || 'Could not archive', 'error');
      return;
    }
    setMessage('Notice archived.', 'success');
    await loadList();
    return;
  }

  if (action === 'email') {
    const ok = await showConfirm({
      title: 'Email active volunteers?',
      message:
        'This sends the notice by email to approved volunteers at this shelter only. Pending, archived, and anonymised accounts are skipped. Email only.',
      confirmLabel: 'Send email',
    });
    if (!ok) return;
    button.disabled = true;
    try {
      const res = await apiRequest(`/announcements/${id}/email`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error || 'Could not send email', 'error');
        return;
      }
      setMessage(data.message || 'Email sent.', 'success');
      await loadList();
    } finally {
      button.disabled = false;
    }
  }
}

async function init() {
  const user = await requireAuth();
  if (!user) return;
  if (!isStaffOrAdminRole(user)) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }
  if (logoutButton) logoutButton.addEventListener('click', () => logout());
  form?.addEventListener('submit', (event) => {
    onSubmit(event).catch((error) => {
      console.error('[Announcements] post error:', error);
      setMessage(error.message || 'Could not post notice', 'error');
    });
  });
  listEl?.addEventListener('click', (event) => {
    onListClick(event).catch((error) => {
      console.error('[Announcements] action error:', error);
      setMessage(error.message || 'Action failed', 'error');
    });
  });
  showArchivedEl?.addEventListener('change', () => {
    loadList().catch((error) => {
      setMessage(error.message || 'Could not load announcements', 'error');
    });
  });

  try {
    await loadList();
  } catch (error) {
    console.error('[Announcements] load error:', error);
    setMessage(error.message || 'Could not load announcements', 'error');
    if (listEl) listEl.innerHTML = '<p class="announcement-empty">Could not load notices.</p>';
  }
}

init();
