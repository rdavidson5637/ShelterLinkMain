let pending = null;

export function loadBrand() {
  if (pending) return pending;
  if (typeof fetch !== 'function') {
    pending = Promise.resolve(null);
    return pending;
  }
  pending = fetch('/api/public/brand', { credentials: 'same-origin' })
    .then((res) => (res.ok ? res.json() : null))
    .catch(() => null);
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
