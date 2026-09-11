# ShelterLink - Cursor prompts, round 3

Shelter and volunteer quality-of-life. Same conventions as before: Express routes in `routes/`, controllers, models, numbered migrations in `database/` folded into `schema.sql`, node --test with mockDb, vanilla JS frontend. Migration numbering continues from 019 (018_optimise_indexes.sql is already in the repo).

Order: 18 first (every other prompt's pages benefit from the shared nav). 23 needs the scheduler (already in). The rest are independent.

Notes: performance indexes are already comprehensive (verified), so no index prompt needed. These are chosen for a real shelter's daily routine: paper day sheets, last-minute cover, volunteers wanting proof of hours.

---

## Prompt 18 - Unified role-aware admin nav

```
Unify navigation across all admin pages in this Express/MySQL volunteer app. Currently each admin page has its own partial nav; only dashboard.html links all sections and group-bookings.html links none.

1. Create frontend/js/components/adminNav.js: a shared component that renders the full admin nav into a placeholder element. Sections: Dashboard, Opportunities, Applications, Volunteers, Approve hours, Messages, Qualifications, Custom fields, Waivers, Feedback, Groups, Reports, Audit log, Privacy. Highlight the current page.
2. Role-aware: fetch the current user once (existing /api/auth/me) and hide admin-only items (Custom fields, Waivers, Qualifications definitions, Reports/export, Audit log, Privacy) from staff sessions. Server-side guards already exist; this is display only.
3. Replace the existing nav markup in every frontend/pages/admin/*.html with the placeholder + script include. Keep the existing logout control and styling classes so nothing else shifts visually.
4. Do the same for volunteer pages with a volunteerNav.js (Dashboard, Browse shifts, Calendar, My applications, My hours, Profile) if they have the same inconsistency; skip if they are already consistent.
5. Mobile: collapse to a simple toggle button below a width breakpoint, vanilla JS, no library.
6. Test: a small DOM-less unit test for the nav item filtering by role (export the item list + filter function separately from the DOM code).
```

---

## Prompt 19 - Printable day sheet

```
Add a daily roster "day sheet" for shelter staff to this Express/MySQL volunteer app. Shelters run mornings off a printed sheet.

1. GET /api/admin/day-sheet?date=YYYY-MM-DD (staff or admin): all opportunities on that date with, per opportunity: title, time, location, check-in code, and the accepted volunteers with name, phone, emergency contact name + phone (from volunteer_profiles), qualification flags relevant to the shift, check-in status, and waitlist count.
2. Page frontend/pages/admin/day-sheet.html: date picker defaulting to today, grouped by opportunity, with a print stylesheet (@media print) that strips nav/buttons and fits A4 portrait. One page per opportunity when printed if the roster is long.
3. Include blank ruled lines under each roster for handwritten walk-in notes.
4. Link it from the admin nav and dashboard ("Today's day sheet").
5. Emergency contact data is sensitive: route restricted to staff/admin, and add an audit_log entry when a day sheet is generated (who, date requested).
6. Tests: date filter correctness, only accepted applications listed, audit row written, staff can access, volunteer role 403.
```

---

## Prompt 20 - Opportunity cloning and urgent cover

```
Add opportunity cloning and an urgent cover broadcast to this Express/MySQL volunteer app.

1. Clone: POST /api/opportunities/:id/clone (staff/admin) copies title, description, location, times, capacity, tags, required qualifications, cutoff - not applications or check-in code (generate fresh). Returns the new draft with date cleared; UI opens the create form pre-filled. Add a "Duplicate" button on the admin opportunities list.
2. Urgent cover: migration database/019_add_urgent.sql adding is_urgent tinyint default 0 and urgent_flagged_at datetime null to opportunities; fold into schema.sql.
3. Admin can flag an open, understaffed, upcoming opportunity as urgent. Flagging sends one broadcast email via the existing email service to approved volunteers who are qualified for it (respect qualification gating) and not already applied, subject "Cover needed: <title> <date>". Cap 200 recipients, log to admin_messages as a send record.
4. Urgent shifts get a highlighted badge at the top of browse-shifts and the public opportunities page, sorted first.
5. Re-flagging within 24h is blocked (one nag per day max).
6. Tests: clone copies tags/quals but not applications and regenerates the check-in code, urgent email excludes existing applicants and unqualified volunteers, 24h re-flag guard.
```

---

## Prompt 21 - Shift notes to the roster

```
Add shift notes to this Express/MySQL volunteer app: admin messages pinned to an opportunity and pushed to its accepted volunteers ("bring wellies", "meet at the back gate").

1. Migration database/020_add_shift_notes.sql: table shift_notes (id, opportunity_id FK, author_id FK users, body text, notify tinyint, created_at). Fold into schema.sql.
2. Staff/admin can add a note from the opportunity detail/edit view. If notify is ticked, email all accepted volunteers on that opportunity (existing email service), subject "Update for your shift: <title> <date>".
3. Volunteers see notes on my-applications under the relevant application and on the opportunity detail, newest first, with author and timestamp.
4. Notes for a shift also appear on the day sheet (if present) and the kiosk shift view (read-only).
5. Keep it simple: no editing, only add and admin delete. Deleting does not re-email.
6. Tests: notify emails accepted volunteers only (not pending/waitlisted/cancelled), note visible to an accepted volunteer's application view, delete restricted to staff/admin.
```

---

## Prompt 22 - Hours certificate and annual summary

```
Give volunteers proof of service in this Express/MySQL volunteer app. Big for students, Duke of Edinburgh, and job applications.

1. Certificate page: from my-hours, "Download certificate" opens frontend/pages/volunteer/certificate.html rendering an A4 landscape print-styled certificate: volunteer name, total approved hours, shifts completed, date range, badges earned, ShelterLink branding, an "issued on" date, and a verification code.
2. Verification: migration database/021_add_cert_verify.sql adding table certificates (id, user_id FK, code varchar(12) unique, issued_at, hours_at_issue decimal, shifts_at_issue int). Fold into schema.sql. Issuing creates a row; public GET /api/public/verify-certificate/:code returns volunteer first name + last initial, hours, shifts, issue date - so a school or employer can verify without an account. Rate-limit it.
3. The certificate is HTML + print CSS only, no PDF library; browsers print to PDF fine.
4. Annual summary job (uses utils/scheduler.js): each 2 January, email every volunteer with approved hours in the previous year a "Your year at the shelter" summary: hours, shifts, badges earned that year, most-attended activity tag. One send per user per year, tracked in job_runs detail.
5. Admin reports: count of certificates issued.
6. Tests: certificate snapshot values frozen at issue time, verify endpoint returns limited fields and 404s bad codes, annual job selects the right recipients once.
```

---

## Prompt 23 - Re-engagement and away mode (needs scheduler)

```
Add volunteer retention tools to this Express/MySQL volunteer app.

1. Migration database/022_add_retention.sql: add away_until date null and last_engagement_email_at datetime null to volunteer_profiles. Fold into schema.sql.
2. Away mode: volunteers set "I'm away until <date>" on their profile. While away: no reminder emails, no match digests, no urgent cover emails, and their profile shows as away on admin volunteers list. Applications and the rest still work.
3. Re-engagement job, weekly: volunteers with an approved profile, not away, whose last approved shift or application activity is older than 8 weeks (env VOLUNTEER_WINBACK_WEEKS, default 8), get one friendly email listing 3 upcoming open shifts matched to their tags. At most one such email per 8 weeks per volunteer (last_engagement_email_at guard). Record in job_runs.
4. Admin volunteers list: "inactive 8+ weeks" filter so staff can see who is drifting.
5. Unsubscribe-lite: the email links to the profile page where away mode doubles as a mute.
6. Tests: away suppresses each mail type, winback selection window and per-volunteer guard, filter query.
```

---

## Prompt 24 - PWA (installable mobile app)

```
Make this Express/MySQL volunteer app's frontend an installable PWA. Volunteers are on phones; paid competitors sell native apps.

1. Add frontend/public/manifest.webmanifest: name ShelterLink, short_name, theme/background colours matching the existing palette, display standalone, start_url /pages/volunteer/dashboard.html, icons 192 and 512 (generate simple paw-print placeholder PNGs into frontend/public/icons/).
2. Service worker frontend/public/sw.js: cache-first for static assets (css, js, icons, fonts), network-first with cache fallback for GET /api/opportunities and /api/stats/me, network-only for everything else (no caching of auth or mutations). Version the cache and clean old caches on activate.
3. Register the service worker from the shared frontend config/bootstrap script; add the manifest link and theme-color meta to every HTML page head.
4. Offline fallback page frontend/offline.html ("You're offline - your shifts will load when you reconnect") served from cache when navigation fails.
5. Make sure helmet CSP allows the service worker and manifest.
6. Test manually with Lighthouse PWA checks; add a unit test only for any cache-name/versioning helper if extracted.
```

---

## Prompt 25 - Accessibility and mobile polish pass

```
Do an accessibility pass on this Express/MySQL volunteer app's vanilla JS frontend. Target WCAG 2.1 AA on the volunteer-facing flows first, then admin.

1. Modals (opportunity modal, confirm dialog): focus trap, Escape closes, focus returns to the trigger, role="dialog" and aria-modal, labelled by their heading.
2. Star rating on the feedback form: make it a radiogroup of real radio inputs, keyboard operable, visually styled as stars.
3. Tag chips: real checkboxes or aria-pressed buttons, keyboard toggling, visible focus ring.
4. Forms: every input labelled (no placeholder-as-label), error messages linked with aria-describedby, error summary focused on failed submit.
5. Tables (admin lists): proper th scope, captions.
6. Colour contrast: check text and status badge combinations against AA and adjust the CSS variables where they fail.
7. Touch targets minimum 44px on volunteer pages and the kiosk; kiosk gets extra-large fonts and buttons.
8. Skip-to-content link and consistent page titles ("Browse shifts - ShelterLink").
9. Keep visual design otherwise unchanged. No component library.
10. Add an ACCESSIBILITY.md note in docs/ summarising what's covered.
```
