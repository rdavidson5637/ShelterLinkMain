/**
 * Ensures a skip-to-content link is the first focusable element, and that
 * its target can take focus. Does not inject a second link when the page
 * already authored one (class="skip-link").
 */

function resolveMain(root) {
  return (
    root.querySelector('main') ||
    root.querySelector('[role="main"]') ||
    root.querySelector('.kiosk-shell')
  );
}

function bindSkipFocus(skip, main) {
  if (!skip || !main || skip.dataset.skipBound === '1') return;
  skip.dataset.skipBound = '1';
  skip.addEventListener('click', (event) => {
    event.preventDefault();
    main.focus();
  });
}

export function applySkipLink(root = document) {
  if (!root?.body) return;

  const main = resolveMain(root);
  if (!main) return;

  if (!main.id) main.id = 'main';
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');

  const existing =
    root.getElementById('skip-to-content') || root.querySelector('a.skip-link');
  if (existing) {
    if (!existing.id) existing.id = 'skip-to-content';
    const hrefId = (existing.getAttribute('href') || '').replace(/^#/, '');
    if (!hrefId || !root.getElementById(hrefId)) {
      existing.setAttribute('href', `#${main.id}`);
    }
    bindSkipFocus(existing, main);
    return;
  }

  const skip = root.createElement('a');
  skip.id = 'skip-to-content';
  skip.className = 'skip-link';
  skip.href = `#${main.id}`;
  skip.textContent = 'Skip to main content';
  root.body.insertBefore(skip, root.body.firstChild);
  bindSkipFocus(skip, main);
}

export function annotateDialogs(root = document) {
  root.querySelectorAll('dialog').forEach((dialog) => {
    if (!dialog.hasAttribute('role')) dialog.setAttribute('role', 'dialog');
    if (!dialog.hasAttribute('aria-modal')) dialog.setAttribute('aria-modal', 'true');
  });
}

if (typeof document !== 'undefined') {
  const run = () => {
    applySkipLink();
    annotateDialogs();
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', run);
  } else {
    run();
  }
}
