import { checkAuth } from '../auth.js';
import { apiRequest } from '../config.js';
import {
  VOLUNTEER_MORE,
  VOLUNTEER_PRIMARY,
  isCurrentPath,
  volunteerMoreContainsPath,
} from './navConfig.js';

function ensureVolunteerNavStyles() {
  if (document.getElementById('volunteer-nav-styles')) return;
  const style = document.createElement('style');
  style.id = 'volunteer-nav-styles';
  style.textContent = `
    .site-nav .nav-menu { flex-wrap: nowrap; flex: 1; }
    .nav-more { position: relative; display: flex; align-items: center; }
    button.nav-more-toggle.secondary {
      display: inline-flex; align-items: center; gap: 0.35rem;
      margin: 0; padding: 0.4rem 0.65rem; width: auto; height: auto;
      line-height: 1.2; border: 0; border-radius: var(--radius-control);
      background: transparent; box-shadow: none; color: var(--text-secondary);
      font: inherit; font-size: 0.9rem; font-weight: 500; cursor: pointer;
      white-space: nowrap;
    }
    .nav-more-toggle::after {
      content: ''; width: 0.35rem; height: 0.35rem;
      border-right: 1.5px solid currentColor; border-bottom: 1.5px solid currentColor;
      transform: rotate(45deg); margin-top: -0.15rem;
    }
    .nav-more-toggle[aria-expanded='true']::after {
      transform: rotate(-135deg); margin-top: 0.15rem;
    }
    button.nav-more-toggle.secondary:hover,
    button.nav-more-toggle.secondary:focus-visible {
      background: var(--green-tint); border: 0; color: var(--text);
    }
    .nav-more-toggle--current { background: var(--green-tint); color: var(--text); font-weight: 600; }
    .nav-more-panel {
      position: absolute; right: 0; top: calc(100% + 4px); min-width: 12.5rem;
      margin: 0; padding: 0.25rem 0; list-style: none; background: var(--surface);
      border: 1px solid var(--border); border-radius: var(--radius-control);
      box-shadow: var(--shadow-card); z-index: 30;
    }
    .nav-more-panel li { display: block; margin: 0; padding: 0; }
    .nav-more-link {
      display: block; margin: 0; padding: 0.55rem 0.85rem;
      color: var(--text-secondary); font-weight: 500; text-decoration: none; white-space: nowrap;
    }
    .nav-more-link:hover, .nav-more-link:focus-visible { background: var(--green-tint); color: var(--text); }
    .nav-more-link[aria-current='page'] { background: var(--green); color: #fff; font-weight: 600; }
    @media (max-width: 600px) {
      .nav-more { display: block; }
      button.nav-more-toggle.secondary {
        width: 100%; justify-content: flex-start; min-height: 44px; padding: 0.75rem 0.65rem;
        pointer-events: none; font-size: 0.78rem; font-weight: 700; letter-spacing: 0.04em;
        text-transform: uppercase; color: var(--text-muted); background: transparent;
      }
      .nav-more-toggle::after { display: none; }
      .nav-more-panel, .nav-more-panel[hidden] {
        display: block !important; position: static; min-width: 0; padding: 0;
        border: 0; border-radius: 0; box-shadow: none; background: transparent;
      }
      .nav-more-link { min-height: 44px; padding: 0.75rem 0.65rem 0.75rem 1.15rem; }
    }
  `;
  document.head.appendChild(style);
}

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
  button.className = 'nav-more-toggle secondary';
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
  ensureVolunteerNavStyles();
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
