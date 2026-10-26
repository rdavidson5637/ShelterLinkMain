import { icon } from './icons.js';

/**
 * Account menu in the header. Sign out lives here, not as a header button.
 * The page's existing #logoutButton is moved into the panel so the logout
 * handlers each page already bound to it keep working.
 */

function firstName(user) {
  const raw = user?.first_name || user?.firstName || String(user?.name || '').split(' ')[0];
  return String(raw || '').trim();
}

function setOpen(wrap, open, { focusToggle = false } = {}) {
  const toggle = wrap.querySelector('.account-menu-toggle');
  const panel = wrap.querySelector('.account-menu-panel');
  toggle.setAttribute('aria-expanded', String(open));
  panel.hidden = !open;
  if (open) {
    panel.querySelector('a, button')?.focus();
  } else if (focusToggle) {
    toggle.focus();
  }
}

/**
 * @param {HTMLElement} navEl  header nav to mount into
 * @param {{ user?: object, links?: { label: string, href: string }[] }} options
 */
export function mountAccountMenu(navEl, { user = null, links = [] } = {}) {
  if (!navEl || navEl.querySelector('.account-menu')) return null;
  const logout = document.getElementById('logoutButton');

  const wrap = document.createElement('div');
  wrap.className = 'account-menu';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'account-menu-toggle';
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'accountMenuPanel');
  const name = firstName(user);
  toggle.innerHTML = `${icon('account', { size: 20 })}<span class="account-menu-label"></span>`;
  toggle.querySelector('.account-menu-label').textContent = name || 'Account';
  if (name) toggle.setAttribute('aria-label', `Account menu for ${name}`);

  const panel = document.createElement('div');
  panel.id = 'accountMenuPanel';
  panel.className = 'account-menu-panel';
  panel.hidden = true;

  links.forEach((link) => {
    const a = document.createElement('a');
    a.className = 'account-menu-item';
    a.href = link.href;
    a.textContent = link.label;
    panel.appendChild(a);
  });

  const reload = document.createElement('button');
  reload.type = 'button';
  reload.className = 'account-menu-item';
  reload.textContent = 'Reload page';
  reload.addEventListener('click', () => window.location.reload());
  panel.appendChild(reload);

  if (logout) {
    logout.className = 'account-menu-item account-menu-signout';
    logout.textContent = 'Sign out';
    panel.appendChild(logout);
  }

  toggle.addEventListener('click', (event) => {
    event.stopPropagation();
    setOpen(wrap, toggle.getAttribute('aria-expanded') !== 'true');
  });
  document.addEventListener('click', (event) => {
    if (!wrap.contains(event.target) && !panel.hidden) setOpen(wrap, false);
  });
  wrap.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && !panel.hidden) {
      event.stopPropagation();
      setOpen(wrap, false, { focusToggle: true });
    }
  });
  wrap.addEventListener('focusout', (event) => {
    if (!panel.hidden && event.relatedTarget && !wrap.contains(event.relatedTarget)) {
      setOpen(wrap, false);
    }
  });

  wrap.append(toggle, panel);
  navEl.appendChild(wrap);
  return wrap;
}
