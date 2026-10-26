import { checkAuth } from '../auth.js';
import { apiRequest } from '../config.js';
import { bindFocusTrap } from '../utils/focusTrap.js';
import { mountAccountMenu } from './accountMenu.js';
import { icon } from './icons.js';
import {
  ADMIN_INSIGHT,
  ADMIN_MANAGE,
  ADMIN_PRIMARY,
  filterNavForRole,
  isCurrentPath,
} from './navConfig.js';

/*
 * Admin shell. From 1024px the #admin-nav aside is a sidebar column. Below
 * that it is a drawer opened from the header Menu button: it traps focus,
 * closes on Escape or the backdrop, and returns focus to the button.
 * Layout is in custom.css.
 */

const DRAWER_QUERY = '(max-width: 1023px)';

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

function createDisclosure(label, items, pathname, panelId) {
  const wrap = document.createElement('div');
  wrap.className = 'nav-disclosure';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'nav-disclosure-toggle';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-controls', panelId);
  button.textContent = label;

  const panel = document.createElement('div');
  panel.id = panelId;
  panel.className = 'nav-disclosure-panel';
  panel.hidden = true;
  items.forEach((item) => panel.appendChild(linkEl(item, pathname)));

  const childCurrent = items.some((item) => isCurrentPath(item.href, pathname));
  if (childCurrent) {
    button.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
  }

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = button.getAttribute('aria-expanded') === 'true';
    button.setAttribute('aria-expanded', String(!open));
    panel.hidden = open;
  });

  wrap.append(button, panel);
  return wrap;
}

export function renderAdminNav(root, role, pathname = window.location.pathname) {
  if (!root) return;
  root.innerHTML = '';

  const head = document.createElement('div');
  head.className = 'drawer-head';
  const title = document.createElement('p');
  title.className = 'drawer-title';
  title.textContent = 'Menu';
  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'drawer-close';
  close.setAttribute('aria-label', 'Close menu');
  close.innerHTML = icon('close');
  head.append(title, close);
  root.appendChild(head);

  const nav = document.createElement('nav');
  nav.setAttribute('aria-label', 'Admin');

  filterNavForRole(ADMIN_PRIMARY, role).forEach((item) => {
    nav.appendChild(linkEl(item, pathname));
  });

  const manage = filterNavForRole(ADMIN_MANAGE, role);
  if (manage.length) {
    nav.appendChild(createDisclosure('Manage', manage, pathname, 'admin-nav-manage'));
  }
  const insight = filterNavForRole(ADMIN_INSIGHT, role);
  if (insight.length) {
    nav.appendChild(createDisclosure('Insight', insight, pathname, 'admin-nav-insight'));
  }

  root.appendChild(nav);
}

function bindDrawer(root) {
  const toggle = document.querySelector('.site-header .nav-toggle');
  if (!toggle || toggle.dataset.navBound === '1') return;
  toggle.dataset.navBound = '1';
  toggle.removeAttribute('aria-label');
  toggle.innerHTML = `${icon('menu', { size: 20 })}<span>Menu</span>`;

  const backdrop = document.createElement('div');
  backdrop.className = 'drawer-backdrop';
  backdrop.hidden = true;
  document.body.appendChild(backdrop);

  const media = window.matchMedia(DRAWER_QUERY);
  let releaseTrap = null;

  const setOpen = (open, { restoreFocus = true } = {}) => {
    root.classList.toggle('nav-open', open);
    document.body.classList.toggle('admin-nav-open', open);
    toggle.setAttribute('aria-expanded', String(open));
    backdrop.hidden = !open;
    if (open) {
      root.setAttribute('role', 'dialog');
      root.setAttribute('aria-modal', 'true');
      root.setAttribute('aria-label', 'Menu');
      releaseTrap = bindFocusTrap(root);
      (root.querySelector('[aria-current="page"]') || root.querySelector('nav a'))?.focus();
    } else {
      root.removeAttribute('role');
      root.removeAttribute('aria-modal');
      root.removeAttribute('aria-label');
      if (releaseTrap) releaseTrap();
      releaseTrap = null;
      if (restoreFocus) toggle.focus();
    }
  };

  toggle.addEventListener('click', () => setOpen(!root.classList.contains('nav-open')));
  root.querySelector('.drawer-close')?.addEventListener('click', () => setOpen(false));
  backdrop.addEventListener('click', () => setOpen(false));
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && root.classList.contains('nav-open')) setOpen(false);
  });
  media.addEventListener('change', (event) => {
    if (!event.matches && root.classList.contains('nav-open')) setOpen(false, { restoreFocus: false });
  });
}

async function mount() {
  const root = document.getElementById('admin-nav');
  if (!root) return;
  const user = await checkAuth().catch(() => null);
  const role = user?.role || '';
  renderAdminNav(root, role);
  bindDrawer(root);
  mountAccountMenu(document.querySelector('.site-header .site-nav'), { user });
  try {
    const res = await apiRequest('/threads/unread-count', { method: 'GET' });
    if (!res.ok) return;
    const data = await res.json();
    const count = Number(data.count) || 0;
    if (!count) return;
    const link =
      root.querySelector('[data-nav-id="messages"]') ||
      Array.from(root.querySelectorAll('a')).find((a) =>
        String(a.getAttribute('href') || '').includes('threads.html')
      );
    if (!link) return;
    const badge = document.createElement('span');
    badge.className = 'nav-unread-badge';
    badge.textContent = count > 99 ? '99+' : String(count);
    badge.setAttribute('aria-label', `${count} unread messages`);
    link.appendChild(badge);
  } catch (_) {
    /* ignore */
  }
}

mount();
