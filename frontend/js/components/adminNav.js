import { checkAuth } from '../auth.js';
import { apiRequest } from '../config.js';
import {
  ADMIN_INSIGHT,
  ADMIN_MANAGE,
  ADMIN_PRIMARY,
  filterNavForRole,
  isCurrentPath,
} from './navConfig.js';

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

function closeAll(root) {
  root.querySelectorAll('.nav-disclosure-toggle').forEach((btn) => {
    btn.setAttribute('aria-expanded', 'false');
  });
  root.querySelectorAll('.nav-disclosure-panel').forEach((panel) => {
    panel.hidden = true;
  });
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
    closeAll(wrap.parentElement || wrap);
    button.setAttribute('aria-expanded', String(!open));
    panel.hidden = open;
  });

  wrap.append(button, panel);
  return wrap;
}

function bindDisclosureChrome(root) {
  const onKey = (event) => {
    if (event.key === 'Escape') closeAll(root);
  };
  const onPointer = (event) => {
    if (!root.contains(event.target)) closeAll(root);
  };
  document.addEventListener('keydown', onKey);
  document.addEventListener('click', onPointer);
}

function bindMobileToggle(navRoot) {
  const toggle = document.querySelector('.site-header .nav-toggle');
  if (!toggle || !navRoot || toggle.dataset.navBound === '1') return;
  toggle.dataset.navBound = '1';
  toggle.addEventListener('click', () => {
    const open = navRoot.classList.toggle('nav-open');
    toggle.setAttribute('aria-expanded', String(open));
    document.body.classList.toggle('admin-nav-open', open);
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && navRoot.classList.contains('nav-open')) {
      navRoot.classList.remove('nav-open');
      toggle.setAttribute('aria-expanded', 'false');
      document.body.classList.remove('admin-nav-open');
      toggle.focus();
    }
  });
}

export function renderAdminNav(root, role, pathname = window.location.pathname) {
  if (!root) return;
  root.innerHTML = '';
  root.setAttribute('aria-label', 'Admin');

  const heading = document.createElement('h3');
  heading.textContent = 'Admin';
  root.appendChild(heading);

  filterNavForRole(ADMIN_PRIMARY, role).forEach((item) => {
    root.appendChild(linkEl(item, pathname));
  });

  const manage = filterNavForRole(ADMIN_MANAGE, role);
  if (manage.length) {
    root.appendChild(createDisclosure('Manage', manage, pathname, 'admin-nav-manage'));
  }
  const insight = filterNavForRole(ADMIN_INSIGHT, role);
  if (insight.length) {
    root.appendChild(createDisclosure('Insight', insight, pathname, 'admin-nav-insight'));
  }

  bindDisclosureChrome(root);
}

async function mount() {
  const root = document.getElementById('admin-nav');
  if (!root) return;
  const user = await checkAuth();
  const role = user?.role || '';
  renderAdminNav(root, role);
  bindMobileToggle(root);
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
