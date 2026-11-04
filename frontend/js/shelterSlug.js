/**
 * Public shelter slug for this page, read from /join/<slug>, /s/<slug>/...,
 * or ?shelter=<slug>. The server resolves the slug; the page never knows or
 * sends a shelter id.
 */
const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SLUG_MAX = 100;

function cleanSlug(value) {
  const slug = String(value || '').trim().toLowerCase();
  if (!slug || slug.length > SLUG_MAX || !SLUG_RE.test(slug)) return null;
  return slug;
}

export function shelterSlugFrom(pathname = '', search = '') {
  const path = String(pathname || '');
  const match = path.match(/^\/(?:join|s)\/([^/?#]+)/);
  if (match) {
    let raw = match[1];
    try {
      raw = decodeURIComponent(raw);
    } catch {
      return null;
    }
    return cleanSlug(raw);
  }
  const params = new URLSearchParams(String(search || ''));
  return cleanSlug(params.get('shelter'));
}

export function currentShelterSlug() {
  if (typeof window === 'undefined' || !window.location) return null;
  return shelterSlugFrom(window.location.pathname, window.location.search);
}

/** Add ?shelter=<slug> to an API path when the page names a shelter. */
export function withShelterQuery(url, slug = currentShelterSlug()) {
  if (!slug) return url;
  const sep = String(url).includes('?') ? '&' : '?';
  return `${url}${sep}shelter=${encodeURIComponent(slug)}`;
}

const LINK_TARGETS = {
  '/index.html': (slug) => `/s/${slug}`,
  '/': (slug) => `/s/${slug}`,
  '/register.html': (slug) => `/join/${slug}`,
  '/pages/opportunities.html': (slug) => `/s/${slug}/opportunities`,
  '/pages/group-booking.html': (slug) => `/s/${slug}/group-booking`,
  '/api/public/opportunities.ics': (slug) => `/api/public/opportunities.ics?shelter=${encodeURIComponent(slug)}`,
};

export function shelterLinkFor(href, slug) {
  if (!slug) return href;
  const build = LINK_TARGETS[href];
  return build ? build(slug) : href;
}

/** Keep visitors on the same shelter as they move between public pages. */
export function applyShelterLinks(root = typeof document === 'undefined' ? null : document) {
  const slug = currentShelterSlug();
  if (!slug || !root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('a[href]').forEach((a) => {
    const next = shelterLinkFor(a.getAttribute('href'), slug);
    if (next !== a.getAttribute('href')) a.setAttribute('href', next);
  });
}
