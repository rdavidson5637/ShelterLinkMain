# Redesign and speed run - changes

Measured numbers only.

## K3 - local dev server, 26 Oct 2026

Signed-in volunteer dashboard was not measured. Demo hints are off, so `/pages/volunteer/dashboard.html` redirects to `/login.html`.

Browser, `http://localhost:3001`, service worker registered at scope `/` with an active controller (desktop browser, `serviceWorker` in `navigator`).

- Login page just after the server restart, while the new service worker took control: `responseStart` 666ms, `loadEventEnd` 745ms.
- Next navigation in the same tab (dashboard redirect back to login): `responseStart` 6ms, `domContentLoadedEventEnd` 42ms, `loadEventEnd` 43ms. CSS, JS and both body fonts plus the 700 weight all reported `transferSize` 0.

`curl` against the same server, two passes: login HTML 1.1ms then 0.9ms, `custom.css` 1.8ms then 1.0ms, Atkinson 400 woff2 1.0ms then 1.7ms, dashboard HTML 1.1ms then 7.6ms. These are loopback times, not the live site. The font response `Cache-Control` is `public, max-age=31536000, immutable`.

## C5 - Lighthouse, local dev server, 26 Oct 2026, after C1 to C4

Lighthouse 12.8.2, headless Chrome, default throttling (mobile is simulated slow 4G and a mid-range phone;
desktop uses the desktop preset). Server is `npm run dev` on this laptop, talking to the Supabase database
in eu-west-1. Single runs, not medians. The desktop home run failed once with `NO_NAVSTART` and was rerun.

| Page | Form | Performance | Accessibility | Best practices | FCP | LCP | TBT | CLS |
|---|---|---|---|---|---|---|---|---|
| `/` | mobile | 98 | 100 | 96 | 1.5 s | 2.0 s | 110 ms | 0 |
| `/` | desktop | 100 | 100 | 96 | 0.4 s | 0.6 s | 0 ms | 0.001 |
| `/pages/volunteer/dashboard.html` | mobile | 86 | 100 | 96 | 2.4 s | 3.8 s | 0 ms | 0.006 |
| `/pages/volunteer/dashboard.html` | desktop | 99 | 100 | 96 | 0.7 s | 0.9 s | 0 ms | 0 |

What these do and do not show:

- The volunteer dashboard rows are not the signed-in dashboard. With no session it redirects to
  `/login.html`, so the score is the redirect plus the sign-in page. No demo login is available (see
  QUESTIONS.md). The mobile LCP of 3.8 s includes the `/api/auth/me` round trip that decides the redirect.
- Best practices is 96 on every page for one reason: the logged-out `/api/auth/me` returns 401 and Chrome
  logs it as a console error. See QUESTIONS.md.
- There are no "before" Lighthouse numbers. Measuring `main` would mean switching branch or copying `.env`,
  and the ground rules rule out both.
