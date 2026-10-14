/* ShelterLink service worker — root scope, versioned caches. */
const CACHE_VERSION = 'shelterlink-__SW_VERSION__';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PAGES_CACHE = `${CACHE_VERSION}-pages`;
const API_CACHE = `${CACHE_VERSION}-api`;

const PRECACHE_URLS = [
  '/offline.html',
  '/public/css/custom.css',
  '/public/icons/icon-192.png',
  '/public/icons/icon-512.png',
  '/public/manifest.webmanifest',
  '/js/pwa.js',
  '/js/offlinePage.js',
  '/public/icons/apple-touch-icon.png',
  '/public/icons/badge-96.png',
  '/public/icons/maskable-192.png',
  '/public/css/vendor/pico-2.1.1.min.css',
];

const NETWORK_FIRST_API = [
  '/api/opportunities',
  '/api/stats/me',
  '/api/auth/me',
  '/api/applications/my-applications',
  '/api/volunteer/profile',
];

const NEVER_CACHE_API = [
  '/api/auth/',
  '/api/admin/',
  '/api/kiosk/',
  '/api/incidents/',
  '/api/vetting/',
  '/api/documents/',
  '/api/export/',
  '/api/push/',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(STATIC_CACHE)
      .then((cache) => cache.addAll(PRECACHE_URLS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => !key.startsWith(CACHE_VERSION))
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'CLEAR_USER_CACHE') return;
  const done = caches.delete(API_CACHE);
  if (event.ports && event.ports[0]) {
    event.waitUntil(
      done.then(() => event.ports[0].postMessage({ ok: true })).catch(() => {
        event.ports[0].postMessage({ ok: false });
      })
    );
  }
});

function isNeverCacheApi(pathname) {
  if (pathname === '/api/auth/me') return false;
  return NEVER_CACHE_API.some((prefix) => pathname.startsWith(prefix));
}

function isNetworkFirstApi(pathname) {
  return NETWORK_FIRST_API.some((path) => pathname === path);
}

function withCacheHeader(response) {
  const headers = new Headers(response.headers);
  headers.set('X-SL-From-Cache', '1');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

async function networkFirstPage(request) {
  const cache = await caches.open(PAGES_CACHE);
  const pageUrl = new URL(request.url);
  pageUrl.search = '';
  const cacheKey = pageUrl.toString();
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(cacheKey, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(cacheKey);
    if (cached) return cached;
    const offline = await caches.match('/offline.html');
    return offline || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response && response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    network.catch(() => {});
    return cached;
  }
  const response = await network;
  if (response) return response;
  throw new Error('network');
}

async function cacheFirst(request) {
  const cache = await caches.open(STATIC_CACHE);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response && response.ok) cache.put(request, response.clone());
  return response;
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  const url = new URL(request.url);
  try {
    const response = await fetch(request);
    if (url.pathname === '/api/auth/me' && (response.status === 401 || response.status === 403)) {
      await caches.delete(API_CACHE);
      return response;
    }
    if (response && response.status >= 200 && response.status < 300) {
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await cache.match(request);
    if (cached) return withCacheHeader(cached);
    throw new Error('offline');
  }
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirstPage(request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (isNeverCacheApi(url.pathname)) return;
    if (isNetworkFirstApi(url.pathname)) {
      event.respondWith(networkFirstApi(request));
    }
    return;
  }

  const path = url.pathname;
  if (path.startsWith('/js/') || path.startsWith('/public/css/')) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  if (
    path.startsWith('/public/icons/') ||
    path.startsWith('/public/images/') ||
    path.endsWith('.png') ||
    path.endsWith('.svg') ||
    path.endsWith('.woff2')
  ) {
    event.respondWith(cacheFirst(request));
  }
});

// Push handlers
function sanitiseNotificationUrl(url) {
  const raw = String(url || '');
  if (raw.startsWith('/') && !raw.startsWith('//')) return raw;
  return '/launch';
}

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    try {
      payload = { body: event.data ? event.data.text() : '' };
    } catch {
      payload = {};
    }
  }
  const title = payload.title || 'ShelterLink';
  const url = sanitiseNotificationUrl(payload.url);
  const tag =
    payload.tag ||
    `${payload.type || 'general'}-${payload.opportunityId || payload.threadId || ''}`;
  const options = {
    body: payload.body || '',
    icon: '/public/icons/icon-192.png',
    badge: '/public/icons/badge-96.png',
    tag,
    renotify: payload.type === 'urgent_cover',
    data: { url },
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = sanitiseNotificationUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
      const existing = windows.find((client) => {
        try {
          return new URL(client.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });
      if (existing && 'focus' in existing) {
        await existing.focus();
        if ('navigate' in existing) await existing.navigate(url);
        return;
      }
      await self.clients.openWindow(url);
    })()
  );
});

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  const output = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; i += 1) {
    output[i] = rawData.charCodeAt(i);
  }
  return output;
}

self.addEventListener('pushsubscriptionchange', (event) => {
  event.waitUntil(
    (async () => {
      try {
        let key = event.oldSubscription && event.oldSubscription.options
          ? event.oldSubscription.options.applicationServerKey
          : null;
        if (!key) {
          const res = await fetch('/api/push/vapid-public-key', { credentials: 'same-origin' });
          const body = await res.json();
          if (!body.publicKey) return;
          key = urlBase64ToUint8Array(body.publicKey);
        }
        const subscription = await self.registration.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: key,
        });
        await fetch('/api/push/subscribe', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ subscription }),
        });
      } catch (error) {
        console.warn('[SW] pushsubscriptionchange failed:', error);
      }
    })()
  );
});
