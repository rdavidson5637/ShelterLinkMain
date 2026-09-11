let chromeBound = false;
let menuSeq = 0;

function menuItemsOf(panel) {
  return Array.from(panel.querySelectorAll('[role="menuitem"]'));
}

function closeAllMenus(except) {
  document.querySelectorAll('.overflow-menu').forEach((menu) => {
    if (except && menu === except) return;
    const button = menu.querySelector('.overflow-menu-toggle');
    const panel = menu.querySelector('.overflow-menu-panel');
    const wasOpen = button?.getAttribute('aria-expanded') === 'true';
    if (button) button.setAttribute('aria-expanded', 'false');
    if (panel) panel.hidden = true;
    if (
      wasOpen &&
      document.activeElement &&
      menu.contains(document.activeElement) &&
      button
    ) {
      button.focus();
    }
  });
}

function bindChrome() {
  if (chromeBound) return;
  chromeBound = true;
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') closeAllMenus();
  });
  document.addEventListener('click', (event) => {
    if (!event.target.closest('.overflow-menu')) closeAllMenus();
  });
}

/**
 * Accessible per-row overflow menu.
 * @param {{ label?: string, items: { label: string, onSelect?: Function, destructive?: boolean, separator?: boolean }[] }} options
 */
export function createOverflowMenu({ label = 'More actions', items = [] } = {}) {
  bindChrome();
  const wrap = document.createElement('div');
  wrap.className = 'overflow-menu';

  const panelId = `overflow-menu-panel-${++menuSeq}`;

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'overflow-menu-toggle secondary button-secondary button-small';
  button.setAttribute('aria-expanded', 'false');
  button.setAttribute('aria-haspopup', 'menu');
  button.setAttribute('aria-controls', panelId);
  button.textContent = label;

  const panel = document.createElement('div');
  panel.id = panelId;
  panel.className = 'overflow-menu-panel';
  panel.hidden = true;
  panel.setAttribute('role', 'menu');
  panel.setAttribute('aria-label', label);

  items.forEach((item) => {
    if (item.separator) {
      const rule = document.createElement('hr');
      rule.className = 'overflow-menu-separator';
      panel.appendChild(rule);
      return;
    }
    const action = document.createElement('button');
    action.type = 'button';
    action.setAttribute('role', 'menuitem');
    action.className = item.destructive
      ? 'overflow-menu-item overflow-menu-item--danger'
      : 'overflow-menu-item';
    action.textContent = item.label;
    action.addEventListener('click', (event) => {
      event.stopPropagation();
      closeAllMenus();
      if (typeof item.onSelect === 'function') item.onSelect();
    });
    panel.appendChild(action);
  });

  function openMenu() {
    closeAllMenus();
    button.setAttribute('aria-expanded', 'true');
    panel.hidden = false;
    menuItemsOf(panel)[0]?.focus();
  }

  button.addEventListener('click', (event) => {
    event.stopPropagation();
    const open = button.getAttribute('aria-expanded') === 'true';
    if (open) {
      closeAllMenus();
      button.focus();
    } else {
      openMenu();
    }
  });

  wrap.addEventListener('keydown', (event) => {
    const itemsEl = menuItemsOf(panel);
    if (!itemsEl.length) return;
    const currentIndex = itemsEl.indexOf(document.activeElement);

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (button.getAttribute('aria-expanded') !== 'true') {
        openMenu();
        return;
      }
      const delta = event.key === 'ArrowDown' ? 1 : -1;
      const next = currentIndex < 0 ? 0 : (currentIndex + delta + itemsEl.length) % itemsEl.length;
      itemsEl[next].focus();
    } else if (event.key === 'Home') {
      event.preventDefault();
      itemsEl[0].focus();
    } else if (event.key === 'End') {
      event.preventDefault();
      itemsEl[itemsEl.length - 1].focus();
    } else if (event.key === 'Tab') {
      closeAllMenus();
    }
  });

  wrap.append(button, panel);
  return wrap;
}

export function createIdentityCell(name, email) {
  const td = document.createElement('td');
  td.className = 'identity-cell';
  const strong = document.createElement('strong');
  strong.textContent = name || 'N/A';
  td.appendChild(strong);
  if (email) {
    const small = document.createElement('small');
    small.textContent = email;
    td.appendChild(small);
  }
  return td;
}
