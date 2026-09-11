/* ShelterLink service worker — cache static assets; network-first for selected GET APIs. */
const CACHE_VERSION = 'shelterlink-v1';
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const API_CACHE = `${CACHE_VERSION}-api`;

const PRECACHE_URLS = [
  '/offline.html',
  '/public/css/custom.css',
  '/public/manifest.webmanifest',
  '/public/icons/icon-192.png',
  '/public/icons/icon-512.png',
  '/public/icons/icon.svg',
];

const NETWORK_FIRST_API = [/^\/api\/opportunities(?:\?|$)/, /^\/api\/stats\/me(?:\?|$)/];

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
            .filter((key) => key !== STATIC_CACHE && key !== API_CACHE)
            .map((key) => caches.delete(key))
        )
      )
      .then(() => self.clients.claim())
  );
});

function isStaticAsset(url) {
  const path = url.pathname;
  return (
    path.startsWith('/public/') ||
    path.startsWith('/js/') ||
    path.endsWith('.css') ||
    path.endsWith('.js') ||
    path.endsWith('.png') ||
    path.endsWith('.svg') ||
    path.endsWith('.woff2') ||
    path.endsWith('.webmanifest')
  );
}

function isNetworkFirstApi(url) {
  if (url.origin !== self.location.origin) return false;
  return NETWORK_FIRST_API.some((re) => re.test(url.pathname + url.search));
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      const cache = await caches.open(STATIC_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    if (request.mode === 'navigate') {
      const offline = await caches.match('/offline.html');
      if (offline) return offline;
    }
    throw error;
  }
}

async function networkFirstApi(request) {
  const cache = await caches.open(API_CACHE);
  try {
    const response = await fetch(request);
    if (response && response.ok) {
      cache.put(request, response.clone());
    }
    return response;
  } catch (error) {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw error;
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

  if (isNetworkFirstApi(url)) {
    event.respondWith(networkFirstApi(request));
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(async () => {
        const offline = await caches.match('/offline.html');
        return offline || Response.error();
      })
    );
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(cacheFirst(request));
  }
  // All other requests: network-only (default browser behaviour).
});
