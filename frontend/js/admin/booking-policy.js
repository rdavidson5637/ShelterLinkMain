// Booking approval policy panel on Review applications (SL-NOW-03).
// Staff can see the policy; only admins can change it or mark volunteers trusted.
import { apiRequest } from '../config.js';

const state = {
  mode: 'approval',
  trusted: new Map(),
  isAdmin: false,
  onChange: null,
};

function el(id) {
  return document.getElementById(id);
}

function setPolicyMessage(text, tone = 'neutral') {
  const box = el('bookingPolicyMessage');
  if (!box) return;
  if (!text) {
    box.replaceChildren();
    return;
  }
  const note = document.createElement('p');
  if (tone === 'error') note.className = 'error';
  if (tone === 'success') note.className = 'success';
  note.textContent = text;
  box.replaceChildren(note);
}

function renderMode() {
  document.querySelectorAll('input[name="booking_mode"]').forEach((input) => {
    input.checked = input.value === state.mode;
    input.disabled = !state.isAdmin;
  });
  const summary = el('bookingModeSummary');
  if (summary) {
    summary.textContent =
      state.mode === 'instant'
        ? 'Trusted volunteers are confirmed straight away. Everyone else waits for you here.'
        : 'Every booking, including a move off the waitlist, waits for you here.';
  }
}

function renderTrusted() {
  const list = el('trustedList');
  const count = el('trustedCount');
  if (count) count.textContent = String(state.trusted.size);
  if (!list) return;
  list.replaceChildren();
  if (!state.trusted.size) {
    const empty = document.createElement('li');
    empty.textContent = 'Nobody yet.';
    list.appendChild(empty);
    return;
  }
  for (const person of state.trusted.values()) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = person.name || person.email || `Volunteer ${person.user_id}`;
    li.appendChild(name);
    if (state.isAdmin) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'secondary button-small';
      remove.textContent = 'Remove';
      remove.setAttribute('aria-label', `Remove trusted status from ${name.textContent}`);
      remove.addEventListener('click', () => setTrusted(person.user_id, false));
      li.append(' ', remove);
    }
    list.appendChild(li);
  }
}

export async function loadBookingPolicy() {
  try {
    const res = await apiRequest('/admin/settings/booking', { method: 'GET' });
    if (!res.ok) {
      setPolicyMessage('Could not load the booking policy.', 'error');
      return;
    }
    const body = await res.json();
    state.mode = body.booking_mode === 'instant' ? 'instant' : 'approval';
    state.trusted = new Map(
      (body.trusted_volunteers || []).map((p) => [String(p.user_id), p])
    );
    renderMode();
    renderTrusted();
  } catch (error) {
    console.error('[Admin] loadBookingPolicy error:', error);
    setPolicyMessage('Network error while loading the booking policy.', 'error');
  }
}

async function saveMode() {
  const picked = document.querySelector('input[name="booking_mode"]:checked');
  if (!picked) return;
  try {
    const res = await apiRequest('/admin/settings/booking', {
      method: 'PUT',
      body: { booking_mode: picked.value },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPolicyMessage(body.error || 'Could not save the booking policy.', 'error');
      return;
    }
    state.mode = body.booking_mode;
    renderMode();
    setPolicyMessage(body.message || 'Saved.', 'success');
  } catch (error) {
    console.error('[Admin] saveMode error:', error);
    setPolicyMessage('Network error while saving the booking policy.', 'error');
  }
}

export function isTrustedUser(userId) {
  return state.trusted.has(String(userId));
}

export function canManageTrust() {
  return state.isAdmin;
}

export async function setTrusted(userId, trusted) {
  try {
    const res = await apiRequest(`/admin/volunteers/${encodeURIComponent(userId)}/trusted`, {
      method: 'PUT',
      body: { trusted: Boolean(trusted) },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      setPolicyMessage(body.error || 'Could not change trusted status.', 'error');
      return;
    }
    await loadBookingPolicy();
    setPolicyMessage(body.message || 'Saved.', 'success');
    if (typeof state.onChange === 'function') state.onChange();
  } catch (error) {
    console.error('[Admin] setTrusted error:', error);
    setPolicyMessage('Network error while changing trusted status.', 'error');
  }
}

export async function initBookingPolicy({ isAdmin = false, onChange = null } = {}) {
  state.isAdmin = Boolean(isAdmin);
  state.onChange = onChange;
  const save = el('saveBookingMode');
  if (save) save.addEventListener('click', saveMode);
  await loadBookingPolicy();
}
