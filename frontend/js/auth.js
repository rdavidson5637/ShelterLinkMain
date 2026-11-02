import { apiRequest } from './config.js';
import { authMeOutcome, createAuthMeLoader } from './authMe.js';
import { isAdminRole, isStaffOrAdminRole } from './utils/roles.js';
import { getRegistration, clearUserCache } from './pwa.js';

export { isAdminRole, isStaffOrAdminRole };

const authMe = createAuthMeLoader(() => apiRequest('/auth/me', { method: 'GET' }));

/** Shared /api/auth/me for this page load. */
export function loadAuthMe() {
  return authMe.load();
}

/** New /api/auth/me. Used by the session timer and "stay logged in". */
export function refreshAuthMe() {
  return authMe.refresh();
}

const REACH_MESSAGE = 'We could not reach ShelterLink. Check your signal and try again.';

function watchUnreachable() {
  if (typeof window === 'undefined' || window.__reachWatch) return;
  window.__reachWatch = true;
  window.addEventListener('unhandledrejection', (event) => {
    if (!event.reason || !event.reason.authUnreachable) return;
    event.preventDefault();
    clearSkeletons();
  });
}

watchUnreachable();

export function reportAuthMe(result) {
  const outcome = authMeOutcome(result);
  if (outcome === 'unreachable') showCouldNotReach();
  else hideCouldNotReach();
  return outcome;
}

function hideCouldNotReach() {
  if (typeof document === 'undefined') return;
  const bar = document.getElementById('reachNotice');
  if (bar) bar.remove();
}

function clearSkeletons() {
  if (typeof document === 'undefined') return;
  document.querySelectorAll('.skeleton').forEach((node) => node.remove());
  document.querySelectorAll('.visually-hidden').forEach((node) => {
    if (node.textContent.trim() === 'Loading') node.remove();
  });
  document.querySelectorAll('tr, li').forEach((row) => {
    const text = row.textContent.replace(/\s+/g, ' ').trim();
    if (text === '' || text === 'Loading') row.remove();
  });
}

function showCouldNotReach() {
  if (typeof document === 'undefined') return;
  if (document.getElementById('reachNotice')) return;

  const bar = document.createElement('div');
  bar.id = 'reachNotice';
  bar.className = 'reach-notice';
  bar.setAttribute('role', 'status');

  const text = document.createElement('p');
  text.textContent = REACH_MESSAGE;

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'secondary';
  retry.textContent = 'Try again';
  retry.addEventListener('click', async () => {
    retry.disabled = true;
    const result = await refreshAuthMe();
    const outcome = reportAuthMe(result);
    if (outcome === 'signed-in') {
      window.location.reload();
      return;
    }
    if (outcome === 'signed-out') {
      window.location.href = '/login.html';
      return;
    }
    retry.disabled = false;
  });

  bar.append(text, retry);
  const header = document.querySelector('header.site-header');
  if (header) header.after(bar);
  else document.body.prepend(bar);
}

export async function checkAuth() {
  const result = await loadAuthMe();
  const outcome = reportAuthMe(result);
  if (outcome === 'unreachable') {
    clearSkeletons();
    const error = new Error(REACH_MESSAGE);
    error.authUnreachable = true;
    throw error;
  }
  if (outcome === 'signed-out') return null;
  return result.user;
}

async function unsubscribePushBestEffort() {
  try {
    const reg = await getRegistration();
    const subscription = await reg?.pushManager?.getSubscription();
    if (!subscription) return;
    await apiRequest('/push/unsubscribe', {
      method: 'POST',
      body: { endpoint: subscription.endpoint },
    });
    await subscription.unsubscribe();
  } catch (_) {
    /* swallow */
  }
}

async function endClientSession() {
  await Promise.race([
    unsubscribePushBestEffort(),
    new Promise((resolve) => setTimeout(resolve, 3000)),
  ]).catch(() => {});
  await clearUserCache();
  try {
    sessionStorage.clear();
  } catch (_) {}
}

export async function logout() {
  await endClientSession();
  try {
    await apiRequest('/auth/logout', { method: 'POST' });
  } catch (_) {
    // ignore network errors; proceed with client-side cleanup
  }
  window.location.href = '/index.html';
}

export async function logoutEverywhere() {
  await endClientSession();
  try {
    await apiRequest('/auth/logout-all', { method: 'POST' });
  } catch (_) {
    // The local session is already cleared. Other devices end when this call succeeds.
  }
  window.location.href = '/login.html';
}

export async function hasPendingWaivers() {
  try {
    const res = await apiRequest('/waivers/pending', { method: 'GET' });
    if (!res.ok) return false;
    const pending = await res.json();
    return Array.isArray(pending) && pending.length > 0;
  } catch (_) {
    return false;
  }
}

/**
 * Redirect volunteers with unaccepted waivers to the blocking accept screen.
 * Returns true if a redirect was triggered.
 */
export async function redirectIfPendingWaivers() {
  const onAcceptPage = window.location.pathname.includes('accept-waiver');
  if (onAcceptPage) return false;
  const pending = await hasPendingWaivers();
  if (!pending) return false;
  window.location.href = '/pages/volunteer/accept-waiver.html';
  return true;
}

export async function redirectIfAuthenticated() {
  let user;
  try {
    user = await checkAuth();
  } catch (error) {
    if (error && error.authUnreachable) return;
    throw error;
  }
  if (!user) return;
  if (user.role === 'admin' || user.role === 'staff') {
    window.location.href = '/pages/admin/dashboard.html';
    return;
  }
  const redirected = await redirectIfPendingWaivers();
  if (redirected) return;
  window.location.href = '/pages/volunteer/dashboard.html';
}

export async function requireAuth() {
  const user = await checkAuth();
  if (!user) {
    window.location.href = '/login.html';
    return null;
  }
  if (user.role === 'volunteer') {
    await redirectIfPendingWaivers();
  }
  return user;
}

/**
 * Hide elements marked data-admin-only when the user is not a full admin.
 */
export function applyRoleVisibility(user) {
  const admin = isAdminRole(user);
  document.querySelectorAll('[data-admin-only]').forEach((el) => {
    el.hidden = !admin;
    if (!admin) el.setAttribute('aria-hidden', 'true');
    else el.removeAttribute('aria-hidden');
  });
}


