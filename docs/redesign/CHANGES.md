# Redesign and speed run - changes

Measured numbers only.

## K3 - local dev server, 26 Oct 2026

Signed-in volunteer dashboard was not measured. Demo hints are off, so `/pages/volunteer/dashboard.html` redirects to `/login.html`.

Browser, `http://localhost:3001`, service worker registered at scope `/` with an active controller (desktop browser, `serviceWorker` in `navigator`).

- Login page just after the server restart, while the new service worker took control: `responseStart` 666ms, `loadEventEnd` 745ms.
- Next navigation in the same tab (dashboard redirect back to login): `responseStart` 6ms, `domContentLoadedEventEnd` 42ms, `loadEventEnd` 43ms. CSS, JS and both body fonts plus the 700 weight all reported `transferSize` 0.

`curl` against the same server, two passes: login HTML 1.1ms then 0.9ms, `custom.css` 1.8ms then 1.0ms, Atkinson 400 woff2 1.0ms then 1.7ms, dashboard HTML 1.1ms then 7.6ms. These are loopback times, not the live site. The font response `Cache-Control` is `public, max-age=31536000, immutable`.
