# Redesign and speed run - changes

Measured numbers only. The summary comes first; the measurement notes behind it follow.

## Summary for Ryan

Branch `redesign/concord-run`, 26 and 27 October 2026. Claude Code and Cursor, coordinated through Concord.
Nothing is pushed. Every task was reviewed by the agent that did not build it, and every finding was
fixed. `npm test` is green (441 tests).

### What it looked like before

From the brief: the Tailwind default teal and amber, the system font, uppercase stat cards showing "-"
for two seconds while data loaded, every section the same rounded card, an automatic dark mode with neon
teal buttons, and a header with a Menu pill, a refresh icon and a full-width Logout button.

From the plan's 26 October measurement: `/api/auth/me` took about 2.1 s at p50 on Railway, and each page
called it up to three times. Every page also fetched `/api/public/brand`, and the scripts loaded as a
three-to-four step import waterfall.

### What it looks like now

- **One look, the yard rota board.** Paper background, ink text, one brand green, a yellow highlighter
  only on what needs someone. Atkinson Hyperlegible Next for reading, Young Serif for page titles, both
  self-hosted with their licences. Light theme only. All colours live in one token block in `custom.css`.
- **Every screen starts with what needs you.** The volunteer home leads with "Needs you" (profile status
  and unfinished onboarding steps), then the next shift with its check-in code, then one line of figures.
  The admin home ("Today at {shelter}") does the same for staff.
- **Lists are ruled rows** with dates down the left, a status word with a dot, and one action. Loading
  shows grey placeholder rows the same size as real ones. No more dashes. Empty lists say so in one sentence.
- **Navigation.** Volunteers on a phone get a bottom tab bar: Home, Shifts, Hours, Messages, More. On
  a laptop it is a top bar. Staff get a sidebar from 1024px and a menu drawer below that. Sign out and
  "Reload page" live in an account menu.
- **Words.** Sentence case everywhere, plain copy, no em dashes, error messages that say what to do.
- **Every page.** All 14 public, 13 volunteer and 23 staff pages are on the new design. No colours sit
  outside the token block, and the only inline styles left are a few show and hide switches that scripts
  flip. Loading shows placeholders, not "Loading..." or dashes.
- **Accessibility.** axe finds nothing on all 50 pages except two FullCalendar internals on the volunteer
  calendar. Lighthouse accessibility is 100 on the pages measured. See `docs/ACCESSIBILITY.md`.
- **Two security fixes found on the way.** Text people had typed was being inserted into pages as HTML in
  two places: animal handling notes on the volunteer foster page, and volunteer names in the reports
  leaderboard. Both now go in as plain text.

### What got faster, and how we know

| Change | Evidence |
|---|---|
| One `/api/auth/me` per page load instead of up to three | K1 test `test/authMeOnce.test.js`; browser check that two callers share one request |
| Shelter brand cached for 10 minutes in the tab | K1, `frontend/js/brand.js` |
| Fonts and every page's scripts preloaded, so there is no import waterfall | K2, `scripts/gen-preloads.js`; `test/preloads.test.js` fails if a page's list goes stale |
| CSS, fonts and shared scripts precached; fonts cached for a year | K3. Second navigation on the dev server: `loadEventEnd` 43 ms, CSS/JS/fonts transferred 0 bytes |
| Home page Lighthouse, mobile | Performance 98, LCP 2.0 s, CLS 0 (C5 table below) |

There are no "before" Lighthouse numbers, for the reason given under C5.

### What is left, and why

- **R1, yours:** move the Railway service from San Francisco to EU West, next to Supabase in Ireland.
  Today every database query crosses the Atlantic, and nothing in this branch can remove that.
- **Decisions waiting in `QUESTIONS.md`:** demo logins for testing, the input border colour, reset
  password length, the logged-out 401 that costs every page a Lighthouse point, the kiosk 401, session
  rolling and the per-request shelter lookup, and trimming Pico (about 5.9 KB gzipped saved).
- **Not seen signed in.** Neither agent had a working login, so signed-in pages were checked with a mocked
  session in the browser (no records touched). Please click through a volunteer and a staff account before
  merging.
- **Browser pop-ups on the staff shifts page.** Closing or deleting a shift still uses the browser's own
  confirm box, and for a repeating series "OK" means "delete the series" and "Cancel" means "close only
  this one", which is easy to get wrong. It needs a proper three-choice dialog. That is a behaviour change,
  so it was left for a follow-up rather than slipped into the restyle.
- **Staff Lighthouse not measured.** Without a session the staff pages redirect to sign-in, so a staff
  Lighthouse run would only re-measure the sign-in page (already in the C5 table).

### Built after the redesign, on separate branches

Each is on its own branch off this one, with a note in `docs/features/` and the decisions it needs:

- `features/yard-board`: a live board of which animals need a walk, who has one out, and take out and
  bring back. Needs migration 036, written for your review and not run on any real database.
- `features/impact-report`: a printable report for funders of what volunteers did between two dates.
  Read-only.
- `features/keep-in-touch`: a staff list of regulars who have stopped coming and approved volunteers who
  never started, with an email link for each. Read-only.

## K3 - local dev server, 26 Oct 2026

Signed-in volunteer dashboard was not measured. Demo hints are off, so `/pages/volunteer/dashboard.html` redirects to `/login.html`.

Browser, `http://localhost:3001`, service worker registered at scope `/` with an active controller (desktop browser, `serviceWorker` in `navigator`).

- Login page just after the server restart, while the new service worker took control: `responseStart` 666ms, `loadEventEnd` 745ms.
- Next navigation in the same tab (dashboard redirect back to login): `responseStart` 6ms, `domContentLoadedEventEnd` 42ms, `loadEventEnd` 43ms. CSS, JS and both body fonts plus the 700 weight all reported `transferSize` 0.

`curl` against the same server, two passes: login HTML 1.1ms then 0.9ms, `custom.css` 1.8ms then 1.0ms, Atkinson 400 woff2 1.0ms then 1.7ms, dashboard HTML 1.1ms then 7.6ms. These are loopback times, not the live site. The font response `Cache-Control` is `public, max-age=31536000, immutable`. The font filenames are not hashed, so a changed font file needs a new name.

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
