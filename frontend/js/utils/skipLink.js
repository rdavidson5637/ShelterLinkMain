/**
 * Injects a skip-to-content link as the first focusable element.
 * Targets <main>, or [role="main"], creating id="main-content" when needed.
 */

export function applySkipLink(root = document) {
  if (!root?.body) return;
  if (root.getElementById('skip-to-content')) return;

  const main =
    root.querySelector('main') ||
    root.querySelector('[role="main"]') ||
    root.querySelector('.kiosk-shell');
  if (!main) return;

  if (!main.id) main.id = 'main-content';
  if (!main.hasAttribute('tabindex')) main.setAttribute('tabindex', '-1');

  const skip = root.createElement('a');
  skip.id = 'skip-to-content';
  skip.className = 'skip-link';
  skip.href = `#${main.id}`;
  skip.textContent = 'Skip to content';
  root.body.insertBefore(skip, root.body.firstChild);

  skip.addEventListener('click', (event) => {
    event.preventDefault();
    main.focus();
  });
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
