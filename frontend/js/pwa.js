/**
 * PWA bootstrap: inject manifest/theme-color, register the root service worker.
 * Imported from footerYear.js so most pages pick it up automatically.
 */

import { showBanner, hideBanner } from './components/statusBanner.js';

const THEME_COLOR = '#1b5e20';
const MANIFEST_HREF = '/public/manifest.webmanifest';
const READY_TIMEOUT_MS = 10000;

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

export function shouldShowUpdateBanner(hadControllerAtLoad) {
  return Boolean(hadControllerAtLoad);
}

export function applyStandaloneClass(doc = document) {
  if (!doc || !doc.documentElement) return false;
  const standalone =
    (typeof window !== 'undefined' &&
      window.matchMedia &&
      window.matchMedia('(display-mode: standalone)').matches) ||
    (typeof navigator !== 'undefined' && navigator.standalone === true);
  doc.documentElement.classList.toggle('is-standalone', Boolean(standalone));
  return Boolean(standalone);
}

async function unregisterPublicScope() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      registrations
        .filter((reg) => String(reg.scope || '').endsWith('/public/'))
        .map((reg) => reg.unregister())
    );
  } catch (_) {
    /* ignore */
  }
}

export function registerServiceWorker() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  return unregisterPublicScope()
    .then(() =>
      navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' })
    )
    .catch((error) => {
      console.warn('[PWA] service worker registration failed:', error.message);
      return null;
    });
}

export function getRegistration() {
  if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
    return Promise.resolve(null);
  }
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((resolve) => {
      setTimeout(() => resolve(null), READY_TIMEOUT_MS);
    }),
  ]).catch(() => null);
}

export async function clearUserCache() {
  try {
    if (typeof navigator !== 'undefined' && navigator.serviceWorker && navigator.serviceWorker.controller) {
      try {
        navigator.serviceWorker.controller.postMessage({ type: 'CLEAR_USER_CACHE' });
      } catch (_) {
        /* ignore */
      }
    }
    if (typeof caches !== 'undefined' && caches.keys) {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((key) => String(key).endsWith('-api')).map((key) => caches.delete(key))
      );
    }
  } catch (_) {
    /* must never throw */
  }
}

function bindConnectivityBanners() {
  if (typeof window === 'undefined') return;
  const showOffline = () => {
    showBanner({
      id: 'offline',
      message: "You're offline. Pages you've opened recently still work. Changes won't save until you reconnect.",
      tone: 'warning',
    });
  };
  window.addEventListener('offline', showOffline);
  window.addEventListener('online', () => hideBanner('offline'));
  if (typeof navigator !== 'undefined' && navigator.onLine === false) showOffline();
}

function bindUpdateBanner() {
  if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
  const hadControllerAtLoad = Boolean(navigator.serviceWorker.controller);
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!shouldShowUpdateBanner(hadControllerAtLoad)) return;
    showBanner({
      id: 'sw-update',
      message: 'ShelterLink has been updated.',
      actionLabel: 'Reload',
      tone: 'info',
      onAction: () => window.location.reload(),
    });
  });
}

export function initPwa() {
  ensurePwaMeta();
  applyStandaloneClass();
  bindUpdateBanner();
  bindConnectivityBanners();
  registerServiceWorker();
}

if (typeof document !== 'undefined') {
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => initPwa());
  } else {
    initPwa();
  }
}
