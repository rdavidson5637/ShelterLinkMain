import { apiRequest } from './config.js';

export async function checkAuth() {
  try {
    const res = await apiRequest('/auth/me', { method: 'GET' });
    if (!res.ok) return null;
    const user = await res.json();
    return user || null;
  } catch (_) {
    return null;
  }
}

export async function logout() {
  try {
    await apiRequest('/auth/logout', { method: 'POST' });
  } catch (_) {
    // ignore network errors; proceed with client-side cleanup
  }
  try {
    sessionStorage.clear();
  } catch (_) {}
  window.location.href = '/index.html';
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
  const user = await checkAuth();
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

export function isAdminRole(user) {
  return Boolean(user && user.role === 'admin');
}

export function isStaffOrAdminRole(user) {
  return Boolean(user && (user.role === 'admin' || user.role === 'staff'));
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


