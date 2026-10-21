/**
 * Shared site footer year and copy.
 * Include this module on every page; it fills footer.container (skipping
 * dialogs) so the year is never hard-coded.
 */
import './skipLink.js';
import '../pwa.js';
import { applyShelterBrand, loadBrand } from '../brand.js';

export function currentFooterYear(now = new Date()) {
  return now.getFullYear();
}

export function footerText(now = new Date(), shelterName = '') {
  const year = currentFooterYear(now);
  const name = String(shelterName || '').trim();
  if (!name) return `© ${year} ShelterLink.`;
  return `© ${year} ShelterLink. ${name}.`;
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
    small.append(footer.ownerDocument.createTextNode(`© ${currentFooterYear()} ShelterLink`));
    const name = footer.ownerDocument.createElement('span');
    name.dataset.shelterName = '';
    small.append(name);
    small.append(footer.ownerDocument.createTextNode(' · '));
    const privacy = footer.ownerDocument.createElement('a');
    privacy.href = '/pages/privacy.html';
    privacy.textContent = 'Privacy';
    small.append(privacy);
  });
}

function startFooter() {
  applySiteFooter();
  if (document.body && document.body.dataset.brandLock === 'token') return;
  loadBrand().then((brand) => applyShelterBrand(brand));
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startFooter);
  } else {
    startFooter();
  }
}
