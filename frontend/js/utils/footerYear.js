/**
 * Shared site footer year and copy.
 * Include this module on every page; it fills footer.container (skipping
 * dialogs) so the year is never hard-coded.
 */
import './skipLink.js';
import '../pwa.js';

export function currentFooterYear(now = new Date()) {
  return now.getFullYear();
}

export function footerText(now = new Date()) {
  return `© ${currentFooterYear(now)} ShelterLink. Assisi Animal Sanctuary.`;
}

export function applySiteFooter(root = document) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const targets = root.querySelectorAll('[data-site-footer], footer.container');
  targets.forEach((footer) => {
    if (footer.closest('dialog, [role="dialog"]')) return;
    let small = footer.querySelector(':scope > small');
    if (!small) {
      small = footer.ownerDocument.createElement('small');
      footer.appendChild(small);
    }
    small.replaceChildren();
    small.append(footer.ownerDocument.createTextNode(`${footerText()} · `));
    const privacy = footer.ownerDocument.createElement('a');
    privacy.href = '/pages/privacy.html';
    privacy.textContent = 'Privacy';
    small.append(privacy);
  });
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => applySiteFooter());
  } else {
    applySiteFooter();
  }
}
