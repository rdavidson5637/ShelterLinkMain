import { apiRequest } from '../config.js';

const SESSION_FLAG_KEY = 'session_expired';
const SESSION_TIMEOUT_MS = 60 * 60 * 1000; // 60 minutes
const WARNING_BEFORE_MS = 5 * 60 * 1000; // 5 minutes before timeout
const CHECK_INTERVAL_MS = 5 * 60 * 1000; // check every 5 minutes

let inactivityTimer = null;
let warningShown = false;

function removeBanner() {
  const existing = document.getElementById('sessionWarningBanner');
  if (existing) existing.remove();
}

function showWarningBanner() {
  if (warningShown) return;
  warningShown = true;

  const banner = document.createElement('div');
  banner.id = 'sessionWarningBanner';
  banner.style.cssText = `
    position: sticky;
    top: 0;
    z-index: 10001;
    background: #ffecb3;
    color: #7a4f01;
    border-bottom: 1px solid #ffb300;
    padding: 0.85rem 1rem;
    font-size: 1rem;
  `;

  const text = document.createElement('span');
  text.textContent = 'Your session will expire in 5 minutes. ';

  const stayLink = document.createElement('button');
  stayLink.type = 'button';
  stayLink.textContent = 'Click here to stay logged in.';
  stayLink.style.cssText = `
    background: transparent;
    border: none;
    color: #7a4f01;
    text-decoration: underline;
    cursor: pointer;
    font-weight: 600;
    padding: 0;
  `;
  stayLink.addEventListener('click', async () => {
    await apiRequest('/auth/me', { method: 'GET' }).catch(() => null);
    warningShown = false;
    removeBanner();
    resetInactivityTimer();
  });

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.textContent = 'Dismiss';
  dismissBtn.style.cssText = 'margin-left: 0.75rem; min-height: 36px;';
  dismissBtn.addEventListener('click', () => removeBanner());

  banner.appendChild(text);
  banner.appendChild(stayLink);
  banner.appendChild(dismissBtn);
  document.body.prepend(banner);
}

function resetInactivityTimer() {
  clearTimeout(inactivityTimer);
  warningShown = false;
  removeBanner();
  inactivityTimer = setTimeout(showWarningBanner, SESSION_TIMEOUT_MS - WARNING_BEFORE_MS);
}

export async function checkSession() {
  try {
    const res = await apiRequest('/auth/me', { method: 'GET' });
    if (res.status === 401) {
      sessionStorage.setItem(SESSION_FLAG_KEY, '1');
      window.location.href = '/login.html';
      return false;
    }
    return true;
  } catch (_) {
    return true;
  }
}

function setupActivityListeners() {
  ['click', 'keypress', 'scroll'].forEach((eventName) => {
    window.addEventListener(eventName, resetInactivityTimer, { passive: true });
  });
}

const PRIVACY_DISMISS_KEY = 'privacy_notice_dismissed';

async function maybeShowPrivacyNotice() {
  try {
    if (sessionStorage.getItem(PRIVACY_DISMISS_KEY) === '1') return;
  } catch (_) {
    /* ignore */
  }
  if (document.getElementById('privacyNoticeBar')) return;

  const res = await apiRequest('/auth/me', { method: 'GET' });
  if (!res.ok) return;
  const user = await res.json().catch(() => null);
  if (!user || !user.needsPrivacyNotice) return;

  const bar = document.createElement('div');
  bar.id = 'privacyNoticeBar';
  bar.className = 'privacy-notice-bar';
  bar.setAttribute('role', 'region');
  bar.setAttribute('aria-label', 'Privacy notice');

  const text = document.createElement('p');
  text.append('Please read the ');
  const link = document.createElement('a');
  link.href = '/pages/privacy.html';
  link.textContent = 'privacy notice';
  text.append(link);
  text.append('. It says what we hold about you.');

  const actions = document.createElement('div');
  actions.className = 'privacy-notice-actions';

  const accept = document.createElement('button');
  accept.type = 'button';
  accept.textContent = 'I have read it';
  accept.addEventListener('click', async () => {
    accept.disabled = true;
    const ack = await apiRequest('/auth/privacy-notice', {
      method: 'POST',
      body: { accept: true },
    });
    if (ack.ok) bar.remove();
    else accept.disabled = false;
  });

  const later = document.createElement('button');
  later.type = 'button';
  later.className = 'secondary';
  later.textContent = 'Not now';
  later.addEventListener('click', () => {
    try {
      sessionStorage.setItem(PRIVACY_DISMISS_KEY, '1');
    } catch (_) {
      /* ignore */
    }
    bar.remove();
  });

  actions.append(accept, later);
  bar.append(text, actions);
  document.body.prepend(bar);
}

function initSessionManager() {
  setupActivityListeners();
  resetInactivityTimer();
  setInterval(checkSession, CHECK_INTERVAL_MS);
  maybeShowPrivacyNotice().catch(() => {});
}

document.addEventListener('DOMContentLoaded', initSessionManager);

