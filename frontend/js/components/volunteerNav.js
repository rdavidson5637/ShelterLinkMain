import { checkAuth } from '../auth.js';
import { apiRequest } from '../config.js';
import {
  VOLUNTEER_MORE,
  VOLUNTEER_PRIMARY,
  isCurrentPath,
  volunteerMoreContainsPath,
} from './navConfig.js';

function appendUnreadBadge(anchor, count) {
  if (!anchor || !count) return;
  const badge = document.createElement('span');
  badge.className = 'nav-unread-badge';
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.setAttribute('aria-label', `${count} unread messages`);
  anchor.appendChild(badge);
}

function linkEl(item, pathname) {
  const a = document.createElement('a');
  a.href = item.href;
  a.textContent = item.label;
  a.dataset.navId = item.id;
  if (isCurrentPath(item.href, pathname)) {
    a.setAttribute('aria-current', 'page');
  }
  return a;
}

function closeMore(root) {
  const toggle = root?.querySelector('.nav-more-toggle');
  const panel = root?.querySelector('.nav-more-panel');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
  if (panel) panel.hidden = true;
}

function createMoreMenu(items, pathname) {
  const wrap = document.createElement('div');
  wrap.className = 'nav-more';

  const childCurrent = volunteerMoreContainsPath(pathname);

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nav-more-toggle';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-haspopup', 'true');
  button.setAttribute('aria-controls', 'volunteer-nav-more');
  button.textContent = 'More';
  if (childCurrent) {
    button.classList.add('nav-more-toggle--current');
  }

  const panel = document.createElement('ul');
  panel.id = 'volunteer-nav-more';
  panel.className = 'nav-more-panel';
  panel.hidden = true;
  items.forEach((item) => {
    const li = document.createElement('li');
    const a = linkEl(item, pathname);
    a.className = 'nav-more-link';
    li.appendChild(a);
    panel.appendChild(li);
  });

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!open));
    panel.hidden = open;
  });

  wrap.append(button, panel);
  return wrap;
}

function bindMoreChrome(listEl) {
  const more = listEl?.querySelector('.nav-more');
  if (!more || more.dataset.navBound === '1') return;
  more.dataset.navBound = '1';
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeMore(more);
  });
  document.addEventListener('click', (event) => {
    if (!more.contains(event.target)) closeMore(more);
  });
}

export function renderVolunteerNav(listEl, pathname = window.location.pathname) {
  if (!listEl) return;
  listEl.innerHTML = '';

  VOLUNTEER_PRIMARY.forEach((item) => {
    const li = document.createElement('li');
    const a = linkEl(item, pathname);
    a.className = 'nav-link';
    li.appendChild(a);
    listEl.appendChild(li);
  });

  const moreLi = document.createElement('li');
  moreLi.appendChild(createMoreMenu(VOLUNTEER_MORE, pathname));
  listEl.appendChild(moreLi);
  bindMoreChrome(listEl);
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
  bindMobileToggle(nav || list.closest('.site-nav'));
  await attachUnreadBadge(list);
}

mount();
