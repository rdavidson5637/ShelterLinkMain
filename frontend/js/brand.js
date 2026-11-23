import { withShelterQuery } from './shelterSlug.js';

let pending = null;

const COLOUR_TOKEN_MAP = {
  green: '--green',
  greenHover: '--green-hover',
  greenTint: '--green-tint',
  greenTintBorder: '--green-tint-border',
  onPrimary: '--on-primary',
  selection: '--selection',
};

export function loadBrand() {
  if (pending) return pending;
  if (typeof fetch !== 'function') {
    pending = Promise.resolve(null);
    return pending;
  }
  pending = fetch(withShelterQuery('/api/public/brand'), { credentials: 'same-origin' })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
  return pending;
}

function applyColourTokens(tokens) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement.style;
  const picoVars = [
    '--pico-primary',
    '--pico-primary-background',
    '--pico-primary-border',
    '--pico-primary-hover',
    '--pico-primary-hover-background',
    '--pico-primary-hover-border',
  ];
  if (!tokens) {
    for (const cssVar of Object.values(COLOUR_TOKEN_MAP)) root.removeProperty(cssVar);
    for (const cssVar of picoVars) root.removeProperty(cssVar);
    return;
  }
  for (const [key, cssVar] of Object.entries(COLOUR_TOKEN_MAP)) {
    const value = tokens[key];
    if (typeof value === 'string' && value && !/["';]/.test(value)) {
      root.setProperty(cssVar, value);
    }
  }
  // Pico primary tracks the brand tokens already defined in custom.css.
  root.setProperty('--pico-primary', 'var(--green)');
  root.setProperty('--pico-primary-background', 'var(--green)');
  root.setProperty('--pico-primary-border', 'var(--green)');
  root.setProperty('--pico-primary-hover', 'var(--green-hover)');
  root.setProperty('--pico-primary-hover-background', 'var(--green-hover)');
  root.setProperty('--pico-primary-hover-border', 'var(--green-hover)');
}

export function applyShelterBrand(brand) {
  if (typeof document === 'undefined' || !brand || !brand.name) return;
  document.querySelectorAll('[data-shelter-name]').forEach((el) => {
    el.textContent = el.closest('footer') ? `. ${brand.name}` : brand.name;
  });
  document.querySelectorAll('[data-shelter-title]').forEach((el) => {
    const pattern = el.getAttribute('data-shelter-title') || '';
    el.textContent = pattern.replaceAll('{name}', brand.name);
  });

  applyColourTokens(brand.colourTokens || null);

  if (!brand.hasLogo) return;
  const logoUrl = brand.logoUrl || withShelterQuery('/api/public/brand/logo');
  if (/["'()]/.test(logoUrl)) return;
  document.documentElement.style.setProperty('--shelter-logo', `url("${logoUrl}")`);
  document.querySelectorAll('.brand-mark').forEach((el) => {
    el.classList.add('has-shelter-logo');
  });
}
