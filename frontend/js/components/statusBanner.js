const banners = new Map();

function ensureStyles(doc) {
  if (doc.getElementById('sl-status-banner-style')) return;
  const style = doc.createElement('style');
  style.id = 'sl-status-banner-style';
  style.textContent = `
    .sl-status-banners {
      position: fixed;
      left: 0;
      right: 0;
      bottom: 0;
      z-index: 1100;
      display: flex;
      flex-direction: column;
      gap: 0.5rem;
      padding: 0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom));
      pointer-events: none;
    }
    .sl-status-banner {
      pointer-events: auto;
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.75rem 1rem;
      background: var(--surface);
      color: var(--text);
      border: 1px solid var(--border-strong);
      border-radius: var(--radius-card);
    }
    .sl-status-banner[data-tone="warning"] {
      background: var(--warning-tint);
      color: var(--warning-text);
      border-color: var(--warning-text);
    }
    .sl-status-banner p { margin: 0; flex: 1; }
    .sl-status-banner button { margin: 0; }
  `;
  doc.head.appendChild(style);
}

function host(doc) {
  let el = doc.getElementById('slStatusBanners');
  if (!el) {
    el = doc.createElement('div');
    el.id = 'slStatusBanners';
    el.className = 'sl-status-banners';
    doc.body.appendChild(el);
  }
  return el;
}

export function showBanner({ id, message, actionLabel, onAction, tone = 'info' } = {}) {
  if (typeof document === 'undefined' || !id) return null;
  ensureStyles(document);
  hideBanner(id);
  const bar = document.createElement('div');
  bar.className = 'sl-status-banner';
  bar.dataset.tone = tone === 'warning' ? 'warning' : 'info';
  bar.setAttribute('role', 'status');
  bar.setAttribute('aria-live', 'polite');
  bar.id = `sl-banner-${id}`;

  const text = document.createElement('p');
  text.textContent = message || '';
  bar.appendChild(text);

  if (actionLabel && typeof onAction === 'function') {
    const action = document.createElement('button');
    action.type = 'button';
    action.textContent = actionLabel;
    action.addEventListener('click', onAction);
    bar.appendChild(action);
  }

  const close = document.createElement('button');
  close.type = 'button';
  close.className = 'secondary';
  close.setAttribute('aria-label', 'Dismiss');
  close.textContent = 'Close';
  close.addEventListener('click', () => hideBanner(id));
  bar.appendChild(close);

  host(document).appendChild(bar);
  banners.set(id, bar);
  return bar;
}

export function hideBanner(id) {
  const existing = banners.get(id);
  if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
  banners.delete(id);
  if (typeof document !== 'undefined') {
    const leftover = document.getElementById(`sl-banner-${id}`);
    if (leftover && leftover.parentNode) leftover.parentNode.removeChild(leftover);
  }
}
