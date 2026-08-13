/**
 * Global fetch error interceptor for API calls.
 * - Redirects to calm error pages on unrecoverable API failures (403/404/500).
 * - Shows toast notifications for recoverable API failures (e.g. 400/409/429).
 */

import { API_URL } from '../config.js';

let installed = false;

function showToast(message = 'Something went wrong.', type = 'error') {
  const toast = document.createElement('div');
  toast.setAttribute('role', 'status');
  toast.setAttribute('aria-live', 'polite');
  toast.style.cssText = `
    position: fixed;
    top: 1rem;
    right: 1rem;
    z-index: 10002;
    padding: 1rem;
    max-width: 360px;
    background: ${type === 'success' ? '#4caf50' : '#f44336'};
    color: #fff;
    border-radius: 8px;
    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.18);
    font-weight: 600;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);

  setTimeout(() => {
    try {
      toast.remove();
    } catch (_) {}
  }, 3500);
}

function getUrl(input) {
  if (!input) return '';
  if (typeof input === 'string') return input;
  return input.url || '';
}

function isApiRequest(url) {
  if (!url) return false;
  return url.includes(`${API_URL}/api/`) || url.includes('/api/');
}

function redirectToErrorPage(status) {
  const map = {
    403: '/pages/error/403.html',
    404: '/pages/error/404.html',
    500: '/pages/error/500.html',
  };
  const target = map[status] || map[500];

  if (window.__shelterlinkErrorRedirected) return;
  window.__shelterlinkErrorRedirected = true;
  window.location.href = target;
}

async function readErrorMessageFromResponse(res) {
  try {
    const clone = res.clone();
    const ct = clone.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      const data = await clone.json();
      return data?.error || data?.message || null;
    }
    return null;
  } catch (_) {
    return null;
  }
}

// Endpoints that are allowed to return 404 as a normal (non-error) response.
// The calling code handles these 404s gracefully itself.
const SOFT_404_PATTERNS = [
  '/volunteer/profile',
  '/volunteer/stats',
  '/hours/stats',
];

function isSoft404(url) {
  return SOFT_404_PATTERNS.some((pattern) => url.includes(pattern));
}

function shouldRedirectStatus(status, url) {
  // A 404 on certain endpoints is a normal application state, not a hard error.
  if (status === 404 && isSoft404(url)) return false;
  return status === 403 || status === 404 || status === 500 || (status >= 500 && status < 600);
}

function shouldToastStatus(status) {
  return status === 400 || status === 409 || status === 422 || status === 429;
}

if (!installed) {
  installed = true;
  const originalFetch = window.fetch.bind(window);

  // eslint-disable-next-line no-global-assign
  window.fetch = async (...args) => {
    const res = await originalFetch(...args);

    const url = getUrl(args[0]);
    const api = isApiRequest(url);
    if (!api) return res;

    const status = res.status;
    if (shouldRedirectStatus(status, url)) {
      redirectToErrorPage(status);
      return res;
    }

    if (shouldToastStatus(status)) {
      const msg = await readErrorMessageFromResponse(res);
      if (msg) showToast(msg, 'error');
      else showToast(`Request failed (${status}).`, 'error');
    }

    return res;
  };
}