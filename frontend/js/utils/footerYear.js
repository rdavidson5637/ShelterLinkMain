/**
 * Shared site footer year and copy.
 * Include this module on every page; it fills footer.container (skipping
 * dialogs) so the year is never hard-coded.
 */
import './skipLink.js';
import '../pwa.js';
import { applyShelterBrand, loadBrand } from '../brand.js';
import { applyShelterLinks } from '../shelterSlug.js';

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
  const targets = root.querySelectorAll('[data-site-footer], footer.container, footer.site-footer');
  targets.forEach((footer) => {
    if (footer.closest('dialog, [role="dialog"]')) return;
    const mount =
      footer.matches('footer.site-footer') && footer.querySelector(':scope > .container')
        ? footer.querySelector(':scope > .container')
        : footer;
    let small = mount.querySelector(':scope > small');
    if (!small) {
      small = footer.ownerDocument.createElement('small');
      mount.prepend(small);
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
    small.append(footer.ownerDocument.createTextNode(' · '));
    const a11y = footer.ownerDocument.createElement('a');
    a11y.href = '/pages/accessibility.html';
    a11y.textContent = 'Accessibility';
    small.append(a11y);
    // Drop hand-authored duplicate legal links inside the footer mount.
    mount
      .querySelectorAll(
        ':scope > a[href="/pages/privacy.html"], :scope > a[href="/pages/accessibility.html"]'
      )
      .forEach((el) => el.remove());
  });
}

function startFooter() {
  applySiteFooter();
  applyShelterLinks();
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
