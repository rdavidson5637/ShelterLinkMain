import { apiRequest } from '../config.js';
import { requireAuth, logout } from '../auth.js';

const container = document.getElementById('waiverContainer');
const messageEl = document.getElementById('message');
const logoutButton = document.getElementById('logoutButton');

let pending = [];
let currentIndex = 0;

function setMessage(text, tone = 'neutral') {
  if (!messageEl) return;
  if (!text) {
    messageEl.innerHTML = '';
    return;
  }
  const cls = tone === 'error' ? 'error' : tone === 'success' ? 'success' : '';
  messageEl.innerHTML = `<p class="${cls}">${text}</p>`;
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function renderCurrent() {
  if (!container) return;
  if (!pending.length) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }

  const w = pending[currentIndex];
  if (!w) {
    window.location.href = '/pages/volunteer/dashboard.html';
    return;
  }

  container.innerHTML = `
    <article>
      <h2>${escapeHtml(w.title)} <small>(v${w.version})</small></h2>
      <p>${currentIndex + 1} of ${pending.length}</p>
      <div class="waiver-scroll" id="waiverBody">${escapeHtml(w.body)}</div>
      <form id="acceptForm">
        <label>
          <input type="checkbox" id="agreed" required />
          I have read and agree to this waiver
        </label>
        <label for="signature">
          Type your full name as signature
          <input type="text" id="signature" name="signature" required autocomplete="name" />
        </label>
        <button type="submit" id="acceptButton">Accept &amp; continue</button>
      </form>
    </article>
  `;

  const form = document.getElementById('acceptForm');
  form?.addEventListener('submit', handleAccept);
}

async function handleAccept(event) {
  event.preventDefault();
  setMessage();

  const w = pending[currentIndex];
  if (!w) return;

  const agreed = document.getElementById('agreed')?.checked;
  const signature = (document.getElementById('signature')?.value || '').trim();
  const acceptButton = document.getElementById('acceptButton');

  if (!agreed) {
    setMessage('Please confirm you agree to the waiver', 'error');
    return;
  }
  if (!signature) {
    setMessage('Please type your full name', 'error');
    return;
  }

  acceptButton?.setAttribute('disabled', 'true');
  try {
    const res = await apiRequest(`/waivers/${w.id}/accept`, {
      method: 'POST',
      body: { agreed: true, signature },
    });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      setMessage(data?.error || 'Unable to record acceptance', 'error');
      return;
    }
    currentIndex += 1;
    if (currentIndex >= pending.length) {
      setMessage('All waivers accepted. Redirecting...', 'success');
      window.location.href = '/pages/volunteer/dashboard.html';
      return;
    }
    setMessage('Accepted. Please review the next waiver.', 'success');
    renderCurrent();
  } catch (error) {
    console.error('[Waiver] accept error:', error);
    setMessage('Network error. Please try again.', 'error');
  } finally {
    acceptButton?.removeAttribute('disabled');
  }
}

async function loadPending() {
  try {
    const res = await apiRequest('/waivers/pending', { method: 'GET' });
    if (!res.ok) {
      setMessage('Unable to load waivers', 'error');
      container.innerHTML = '';
      return;
    }
    pending = await res.json();
    currentIndex = 0;
    if (!pending.length) {
      window.location.href = '/pages/volunteer/dashboard.html';
      return;
    }
    renderCurrent();
  } catch (error) {
    console.error('[Waiver] loadPending error:', error);
    setMessage('Network error while loading waivers', 'error');
  }
}

async function init() {
  await requireAuth();
  logoutButton?.addEventListener('click', (e) => {
    e.preventDefault();
    logout();
  });
  await loadPending();
}

document.addEventListener('DOMContentLoaded', init);
