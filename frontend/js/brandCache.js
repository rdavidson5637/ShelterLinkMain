/** sessionStorage cache for GET /api/public/brand. 10 minutes. */

export const BRAND_CACHE_TTL_MS = 10 * 60 * 1000;
export const BRAND_CACHE_KEY = 'sl.publicBrand';

export function readBrandCache(raw, now, ttl = BRAND_CACHE_TTL_MS) {
  if (!raw || typeof raw !== 'string') return { hit: false };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { hit: false };
  }
  if (!parsed || typeof parsed.storedAt !== 'number' || !parsed.brand) {
    return { hit: false };
  }
  const age = now - parsed.storedAt;
  if (age < 0 || age >= ttl) return { hit: false };
  return { hit: true, brand: parsed.brand };
}

export function writeBrandCache(brand, now) {
  if (!brand || typeof brand !== 'object') return null;
  return JSON.stringify({ storedAt: now, brand });
}
