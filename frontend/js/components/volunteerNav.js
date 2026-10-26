import { checkAuth } from '../auth.js';
import { apiRequest } from '../config.js';
import { mountAccountMenu } from './accountMenu.js';
import { icon } from './icons.js';
import {
  VOLUNTEER_MORE,
  VOLUNTEER_PRIMARY,
  isCurrentPath,
  volunteerMoreContainsPath,
} from './navConfig.js';

/*
 * Volunteer shell. Desktop (768px and up): links in the top bar with a More
 * menu. Mobile: a bottom tab bar (Home, Shifts, Hours, Messages, More).
 * Sign out lives in the account menu. Layout is in custom.css.
 */

function appendUnreadBadge(anchor, count) {
  if (!anchor || !count) return;
  const badge = document.createElement('span');
  badge.className = 'nav-unread-badge';
  badge.textContent = count > 99 ? '99+' : String(count);
  badge.setAttribute('aria-label', `${count} unread`);
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

/** A More button plus a panel of links. Used by the top bar and the tab bar. */
function createMoreMenu({ items, pathname, panelId, buttonClass, panelClass, buttonHtml }) {
  const wrap = document.createElement('div');
  wrap.className = 'nav-more';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = buttonClass;
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', panelId);
  button.innerHTML = buttonHtml;
  if (volunteerMoreContainsPath(pathname)) {
    button.classList.add('is-current');
  }

  const panel = document.createElement('ul');
  panel.id = panelId;
  panel.className = panelClass;
  panel.hidden = true;
  items.forEach((item) => {
    const li = document.createElement('li');
    const a = linkEl(item, pathname);
    a.className = 'nav-more-link';
    li.appendChild(a);
    panel.appendChild(li);
  });

  const close = ({ focusButton = false } = {}) => {
    button.setAttribute('aria-expanded', 'false');
    panel.hidden = true;
    if (focusButton) button.focus();
  };

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = button.getAttribute('aria-expanded') === 'true';
    if (open) {
      close();
      return;
    }
    button.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    panel.querySelector('a')?.focus();
  });
  wrap.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.stopPropagation();
      close({ focusButton: true });
    }
  });
  wrap.addEventListener('focusout', (event) => {
    if (!panel.hidden && event.relatedTarget && !wrap.contains(event.relatedTarget)) close();
  });
  document.addEventListener('click', (event) => {
    if (!wrap.contains(event.target) && !panel.hidden) close();
  });

  wrap.append(button, panel);
  return wrap;
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
  moreLi.appendChild(
    createMoreMenu({
      items: VOLUNTEER_MORE,
      pathname,
      panelId: 'volunteer-nav-more',
      buttonClass: 'nav-link nav-more-toggle',
      panelClass: 'nav-more-panel',
      buttonHtml: 'More',
    })
  );
  listEl.appendChild(moreLi);
}

export function renderTabBar(pathname = window.location.pathname) {
  const existing = document.querySelector('.tab-bar');
  if (existing) existing.remove();

  const bar = document.createElement('nav');
  bar.className = 'tab-bar';
  bar.setAttribute('aria-label', 'Volunteer tabs');

  const list = document.createElement('ul');
  VOLUNTEER_PRIMARY.forEach((item) => {
    const li = document.createElement('li');
    const a = linkEl(item, pathname);
    a.className = 'tab-bar-link';
    a.innerHTML = `${icon(item.icon)}<span class="tab-bar-label"></span>`;
    a.querySelector('.tab-bar-label').textContent = item.label;
    li.appendChild(a);
    list.appendChild(li);
  });

  const moreLi = document.createElement('li');
  moreLi.appendChild(
    createMoreMenu({
      items: VOLUNTEER_MORE,
      pathname,
      panelId: 'volunteer-tab-more',
      buttonClass: 'tab-bar-link nav-more-toggle',
      panelClass: 'tab-bar-sheet',
      buttonHtml: `${icon('more')}<span class="tab-bar-label">More</span>`,
    })
  );
  list.appendChild(moreLi);

  bar.appendChild(list);
  document.body.appendChild(bar);
  document.body.classList.add('has-tab-bar');
  return bar;
}

async function attachUnreadBadges() {
  const links = document.querySelectorAll('[data-nav-id="messages"]');
  if (!links.length) return;
  try {
    const res = await apiRequest('/threads/unread-count', { method: 'GET' });
    if (!res.ok) return;
    const data = await res.json();
    const count = Number(data.count) || 0;
    links.forEach((link) => appendUnreadBadge(link, count));
  } catch (_) {
    /* ignore */
  }
}

async function mount() {
  const nav = document.querySelector('nav[aria-label="Volunteer navigation"]');
  const list = document.getElementById('navMenu') || nav?.querySelector('[data-volunteer-nav], .nav-menu');
  if (!list) return;
  const navRoot = nav || list.closest('.site-nav');
  // The tab bar replaces the old Menu toggle.
  navRoot?.querySelector('.nav-toggle')?.remove();
  navRoot?.classList.add('site-nav--volunteer');

  const user = await checkAuth().catch(() => null);
  renderVolunteerNav(list);
  renderTabBar();
  mountAccountMenu(navRoot, {
    user,
    links: [{ label: 'Your profile', href: '/pages/volunteer/complete-profile.html' }],
  });
  await attachUnreadBadges();
}

mount();
