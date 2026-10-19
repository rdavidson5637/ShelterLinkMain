import { checkAuth } from '../auth.js';
import { apiRequest } from '../config.js';
import { VOLUNTEER_NAV, isCurrentPath } from './navConfig.js';

function appendUnreadBadge(anchor, count) {
  if (!anchor || !count) return;
  const badge = document.createElement('span');
  badge.className = 'nav-unread-badge';
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.setAttribute('aria-label', `${count} unread messages`);
  anchor.appendChild(badge);
}

export function renderVolunteerNav(listEl, pathname = window.location.pathname) {
  if (!listEl) return;
  listEl.innerHTML = '';
  VOLUNTEER_NAV.forEach((item) => {
    const li = document.createElement('li');
    const a = document.createElement('a');
    a.className = 'nav-link';
    a.href = item.href;
    a.textContent = item.label;
    a.dataset.navId = item.id;
    if (isCurrentPath(item.href, pathname)) {
      a.setAttribute('aria-current', 'page');
    }
    li.appendChild(a);
    listEl.appendChild(li);
  });
}

async function attachUnreadBadge(listEl) {
  const link = listEl?.querySelector('[data-nav-id="messages"]');
  if (!link) return;
  try {
    const res = await apiRequest('/threads/unread-count', { method: 'GET' });
    if (!res.ok) return;
    const data = await res.json();
    appendUnreadBadge(link, Number(data.count) || 0);
  } catch (_) {
    /* ignore */
  }
}

function addRefreshButton(nav) {
  if (!nav || nav.querySelector('.nav-refresh')) return;
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'nav-refresh';
  btn.setAttribute('aria-label', 'Refresh');
  btn.innerHTML =
    '<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M17.6 6.4A8 8 0 1 0 20 12h-2a6 6 0 1 1-1.8-4.2L14 10h6V4l-2.4 2.4z"/></svg>';
  btn.addEventListener('click', () => window.location.reload());
  const logout = nav.querySelector('#logoutButton');
  if (logout) nav.insertBefore(btn, logout);
  else nav.appendChild(btn);
}

function bindMobileToggle(nav) {
  const toggle = nav?.querySelector('.nav-toggle');
  if (!nav || !toggle || toggle.dataset.navBound === '1') return;
  toggle.dataset.navBound = '1';
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && nav.classList.contains('nav-open')) {
      nav.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.focus();
    }
  });
}

async function mount() {
  const nav = document.querySelector('nav[aria-label="Volunteer navigation"]');
  const list = document.getElementById('navMenu') || nav?.querySelector('[data-volunteer-nav], .nav-menu');
  if (!list) return;
  await checkAuth();
  renderVolunteerNav(list);
  const navRoot = nav || list.closest('.site-nav');
  bindMobileToggle(navRoot);
  addRefreshButton(navRoot);
  await attachUnreadBadge(list);
}

mount();
