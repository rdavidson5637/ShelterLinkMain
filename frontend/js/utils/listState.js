/**
 * Shared empty and recoverable error panels for list-style pages.
 * Keep copy plain; callers own the wording.
 */

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (value == null || value === false) continue;
    if (key === 'className') node.className = value;
    else if (key === 'text') node.textContent = value;
    else if (key.startsWith('on') && typeof value === 'function') {
      node.addEventListener(key.slice(2).toLowerCase(), value);
    } else node.setAttribute(key, value === true ? '' : String(value));
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(typeof child === 'string' ? document.createTextNode(child) : child);
  }
  return node;
}

export function renderEmptyState({ title, body, actionHref, actionLabel } = {}) {
  const actions = [];
  if (actionHref && actionLabel) {
    actions.push(el('a', { className: 'text-link', href: actionHref, text: actionLabel }));
  }
  return el('div', { className: 'empty-state', role: 'status' }, [
    title ? el('h2', { text: title }) : null,
    body ? el('p', { text: body }) : null,
    actions.length ? el('p', { className: 'empty-state-actions' }, actions) : null,
  ]);
}

export function renderErrorState({ title, body, onRetry, retryLabel = 'Try again' } = {}) {
  const actions = [];
  if (typeof onRetry === 'function') {
    actions.push(
      el('button', { type: 'button', className: 'secondary', onClick: onRetry, text: retryLabel })
    );
  }
  return el('div', { className: 'error-state', role: 'alert' }, [
    title ? el('h2', { text: title }) : null,
    body ? el('p', { text: body }) : null,
    actions.length ? el('p', { className: 'error-state-actions' }, actions) : null,
  ]);
}
