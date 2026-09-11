/**
 * PWA bootstrap: inject manifest/theme-color and register the service worker.
 * Imported from footerYear.js so most pages pick it up automatically.
 */

const THEME_COLOR = '#1b5e20';
const MANIFEST_HREF = '/public/manifest.webmanifest';

export function ensurePwaMeta(doc = document) {
  if (!doc || !doc.head) return;

  let theme = doc.querySelector('meta[name="theme-color"]');
  if (!theme) {
    theme = doc.createElement('meta');
    theme.setAttribute('name', 'theme-color');
    doc.head.appendChild(theme);
  }
  theme.setAttribute('content', THEME_COLOR);

  let manifest = doc.querySelector('link[rel="manifest"]');
  if (!manifest) {
    manifest = doc.createElement('link');
    manifest.setAttribute('rel', 'manifest');
    doc.head.appendChild(manifest);
  }
  manifest.setAttribute('href', MANIFEST_HREF);
}

export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  return navigator.serviceWorker.register('/public/sw.js').catch((error) => {
    console.warn('[PWA] service worker registration failed:', error.message);
    return null;
  });
}

export function initPwa() {
  ensurePwaMeta();
  registerServiceWorker();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initPwa());
  } else {
    initPwa();
  }
}
