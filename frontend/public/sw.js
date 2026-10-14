/* Kill-switch for devices that registered the old /public/ scope. */
self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((key) => key.startsWith('shelterlink-v1'))
          .map((key) => caches.delete(key))
      );
      await self.registration.unregister();
    })()
  );
});
