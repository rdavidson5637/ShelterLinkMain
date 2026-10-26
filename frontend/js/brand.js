import { BRAND_CACHE_KEY, readBrandCache, writeBrandCache } from './brandCache.js';

let pending = null;

function brandStorage() {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

async function resolveBrand() {
  const storage = brandStorage();
  const now = Date.now();
  if (storage) {
    const cached = readBrandCache(storage.getItem(BRAND_CACHE_KEY), now);
    if (cached.hit) return cached.brand;
  }
  if (typeof fetch !== 'function') return null;
  try {
    const res = await fetch('/api/public/brand', { credentials: 'same-origin' });
    const brand = res.ok ? await res.json() : null;
    if (brand && storage) {
      const raw = writeBrandCache(brand, now);
      if (raw) {
        try {
          storage.setItem(BRAND_CACHE_KEY, raw);
        } catch {
          /* quota or private mode */
        }
      }
    }
    return brand;
  } catch {
    return null;
  }
}

export function loadBrand() {
  if (pending) return pending;
  pending = resolveBrand();
  return pending;
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
  if (!brand.hasLogo) return;
  const logoUrl = brand.logoUrl || '/api/public/brand/logo';
  if (/["'()]/.test(logoUrl)) return;
  document.documentElement.style.setProperty('--shelter-logo', `url("${logoUrl}")`);
  document.querySelectorAll('.brand-mark').forEach((el) => {
    el.classList.add('has-shelter-logo');
  });
}
