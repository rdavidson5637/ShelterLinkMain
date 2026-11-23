import { apiRequest } from '../config.js';
import { requireAuth, logout } from '../auth.js';
import { escapeHtml } from '../utils/escapeHtml.js';
import { showConfirm } from '../components/confirmDialog.js';

const messageEl = document.getElementById('message');
const listEl = document.getElementById('eventList');
const logoutButton = document.getElementById('logoutButton');

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  messageEl.textContent = text || '';
  messageEl.dataset.tone = tone;
}

function formatDate(value) {
  if (!value) return '';
  return String(value).slice(0, 10);
}

function renderItems(items) {
  if (!listEl) return;
  if (!items.length) {
    listEl.innerHTML =
      '<p class="event-empty">No upcoming shelter events right now.</p>';
    return;
  }

  listEl.innerHTML = `<ul class="event-ruled-list">${items
    .map((item) => {
      const date = formatDate(item.event_date);
      const filled = Number(item.spots_filled) || 0;
      const capacity = Number(item.capacity) || 0;
      const remaining = Number(item.spots_remaining);
      const signedUp = Boolean(item.my_signup);
      const full = !signedUp && remaining <= 0;
      let action = '';
      if (signedUp) {
        action = `<button type="button" class="secondary" data-action="cancel">Cancel sign-up</button>`;
      } else if (full) {
        action = `<span class="event-meta">Full</span>`;
      } else {
        action = `<button type="button" data-action="signup">Sign up</button>`;
      }
      return `<li data-id="${item.id}">
        <div class="event-ruled-main">
          <strong>${escapeHtml(item.title)}</strong>
          <p>${escapeHtml(item.description)}</p>
          <p class="event-meta">
            ${escapeHtml(date)} · ${escapeHtml(item.location || '')}
            · ${filled} of ${capacity} places
            ${signedUp ? ' · You are signed up' : ''}
          </p>
        </div>
        <div class="event-ruled-actions">${action}</div>
      </li>`;
    })
    .join('')}</ul>`;
}

async function loadList() {
  const res = await apiRequest('/events', { method: 'GET' });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || 'Could not load events');
  }
  const data = await res.json();
  renderItems(Array.isArray(data.items) ? data.items : []);
}

async function onListClick(event) {
  const button = event.target.closest('button[data-action]');
  if (!button || !listEl?.contains(button)) return;
  const row = button.closest('li[data-id]');
  const id = row?.getAttribute('data-id');
  if (!id) return;
  const action = button.getAttribute('data-action');

  if (action === 'signup') {
    button.disabled = true;
    try {
      const res = await apiRequest(`/events/${id}/signup`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error || 'Could not sign up', 'error');
        return;
      }
      setMessage('You are signed up for this event.', 'success');
      await loadList();
    } finally {
      button.disabled = false;
    }
    return;
  }

  if (action === 'cancel') {
    const ok = await showConfirm({
      title: 'Cancel your sign-up?',
      message: 'Your place will free up for someone else.',
      confirmLabel: 'Cancel sign-up',
    });
    if (!ok) return;
    button.disabled = true;
    try {
      const res = await apiRequest(`/events/${id}/cancel`, { method: 'POST' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setMessage(data.error || 'Could not cancel', 'error');
        return;
      }
      setMessage('Sign-up cancelled.', 'success');
      await loadList();
    } finally {
      button.disabled = false;
    }
  }
}

async function init() {
  const user = await requireAuth();
  if (!user) return;
  if (logoutButton) logoutButton.addEventListener('click', () => logout());
  listEl?.addEventListener('click', (event) => {
    onListClick(event).catch((error) => {
      console.error('[Events] action error:', error);
      setMessage(error.message || 'Action failed', 'error');
    });
  });

  try {
    await loadList();
  } catch (error) {
    console.error('[Events] load error:', error);
    setMessage(error.message || 'Could not load events', 'error');
    if (listEl) listEl.innerHTML = '<p class="event-empty">Could not load events.</p>';
  }
}

init();
