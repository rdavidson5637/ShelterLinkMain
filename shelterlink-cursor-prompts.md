# ShelterLink - Cursor prompts

Target folder: `shelterlink cursor`. It already has password reset (001) and phone (002) migrations, so **skip Prompt 1** and start migration numbering from 003.

Run in order. Each prompt is self-contained. 4 (scheduler) is needed by 5, 10 and 16. 6 is needed by 17. Everything else is independent but assumes earlier prompts have run (migrations are numbered accordingly).

Two rounds: prompts 2-9 close the gaps vs the market baseline. Prompts 10-17 add the features paid platforms charge for (qualifications, waivers, matching, roles, surveys, groups, kiosk, GDPR). After both rounds ShelterLink matches or beats mid-tier paid tools for a single shelter.

Conventions the prompts assume (matches your codebase): Express routes in `routes/`, handlers in `controllers/`, data access in `models/`, SQL migrations as numbered files in `database/` also folded into `database/schema.sql`, tests in `test/` using node --test with the mockDb helper, vanilla JS frontend in `frontend/`.

---

## Prompt 1 - Password reset

```
Add password reset to this Express/MySQL app, following the existing structure (routes/, controllers/, models/, middleware/, utils/emailService).

1. Migration database/00X_add_password_reset.sql: add password_reset_token (varchar 255, nullable) and password_reset_expires (datetime, nullable) to users. Fold into database/schema.sql too.
2. POST /api/auth/forgot-password: accepts email. Always respond 200 with a generic message whether or not the user exists. If the user exists, generate a crypto-random token, store its bcrypt hash and a 1-hour expiry, and send a reset link via utils/emailService (frontend/pages/reset-password.html?token=...&email=...). If email is not configured, log the link server-side like the rest of the email service does.
3. POST /api/auth/reset-password: accepts email, token, newPassword. Verify token hash and expiry, enforce the same password rules as registration, hash with bcrypt, clear the token fields, destroy any existing sessions for that user.
4. Rate-limit both endpoints with the existing rateLimiter middleware (tight, e.g. 5 per 15 min).
5. Frontend: forgot-password.html (email form) and reset-password.html (new password form), linked from the login page, using the existing page structure, PicoCSS styling and fetch helpers in frontend/js.
6. Tests in test/ using the existing mockDb pattern: token expiry rejected, wrong token rejected, generic response for unknown email, successful reset clears token.

Do not touch existing auth flows beyond adding the login-page link.
```

---

## Prompt 2 - Recurring shifts

```
Add recurring opportunities to this Express/MySQL volunteer app.

1. Migration database/00X_add_recurrence.sql: add recurrence_rule enum('none','daily','weekly') default 'none', recurrence_until date null, and parent_opportunity_id int null (FK to opportunities.id, on delete set null) to opportunities. Fold into database/schema.sql.
2. In opportunityController.createOpportunity: if recurrence_rule is not 'none' and recurrence_until is set, create the first opportunity as the parent, then generate child rows (same fields, shifted dates) up to recurrence_until, capped at 26 occurrences. Validate recurrence_until is after the start date.
3. Admin UI (frontend/pages/admin/create-opportunity.html + its JS): add a "Repeats" select (None/Daily/Weekly) and an "Until" date input shown only when repeating. On submit, pass the new fields.
4. When an admin deletes a parent opportunity, ask via the API whether to delete the whole series: support DELETE /api/opportunities/:id?series=true which deletes the parent and all children that have no accepted applications, and reports how many were skipped.
5. Show a repeat indicator on the admin opportunities list and in the volunteer calendar event tooltips.
6. Tests with the mockDb pattern: weekly generation count, cap at 26, series delete skips opportunities with accepted applications.

Keep single (non-recurring) creation behaviour byte-for-byte identical.
```

---

## Prompt 3 - Waitlists

```
Add waitlists to this Express/MySQL volunteer app. Currently opportunities auto-close when capacity is reached and further applications are blocked.

1. Migration database/00X_add_waitlist.sql: extend applications.status to include 'waitlisted'. Fold into schema.sql.
2. applicationController: when a volunteer applies to a full but otherwise open opportunity, create the application with status 'waitlisted' instead of rejecting. Keep the profile-approval gating exactly as is.
3. Promotion: when an accepted application is cancelled or rejected, or an admin raises max_volunteers, promote the oldest waitlisted application to 'pending' and notify the volunteer via the existing email service ("A spot opened up, your application is now pending review").
4. Volunteer UI: browse-shifts shows "Join waitlist" on full shifts; my-applications shows waitlist position (count of earlier waitlisted applications for that opportunity + 1).
5. Admin UI: review-applications shows waitlisted applicants in their own group with position order; admins can accept from the waitlist directly if capacity allows.
6. Tests: apply-when-full creates waitlisted, cancellation promotes oldest first, promotion email fires, accepting from waitlist respects capacity.
```

---

## Prompt 4 - Scheduler foundation

```
Add a minimal in-process job scheduler to this Express app. No new heavy dependencies; use node-cron (small, no native deps) or a plain setInterval wrapper if you judge it cleaner.

1. Create utils/scheduler.js exposing registerJob(name, cronExpression, fn) with per-job error handling (a failing job logs and never crashes the process) and a started flag so tests can import jobs without starting timers.
2. Start the scheduler from server.js only when NODE_ENV !== 'test'.
3. Add a jobs/ directory with an index that registers all jobs, currently empty.
4. Add a migration database/00X_add_job_log.sql creating job_runs (id, job_name, ran_at, status enum('ok','error'), detail text) so jobs can record runs and stay idempotent. Fold into schema.sql.
5. Unit test: a registered job that throws is caught and logged, scheduler does not start under test env.
```

---

## Prompt 5 - Shift reminders and no-show tracking (needs Prompt 4)

```
Using the existing utils/scheduler.js and jobs/ setup, add automated shift reminder emails and no-show tracking.

1. Migration database/00X_add_reminders_noshow.sql: add reminder_sent_at datetime null to applications, and no_show tinyint(1) default 0. Fold into schema.sql.
2. Job jobs/shiftReminders.js, hourly: find accepted applications for opportunities starting in the next 24h where reminder_sent_at is null, send a reminder via the existing email service (shift title, date, time, location), set reminder_sent_at. Record the run in job_runs. Idempotent by design.
3. No-shows: on the admin review side, after an opportunity's date has passed, admins can mark accepted applications as no-show (PATCH /api/applications/:id/no-show, admin only, only for past opportunities). Show a no-show count on the admin volunteers list.
4. Volunteer dashboard: show "next shift" card with date countdown.
5. Tests: reminder query picks only <24h unsent accepted apps, reminder_sent_at prevents duplicates, no-show endpoint rejects future opportunities and non-admins.
```

---

## Prompt 6 - Check-in codes

```
Add lightweight shift check-in to this Express/MySQL volunteer app, replacing purely self-reported hours with verified ones where used.

1. Migration database/00X_add_checkin.sql: add check_in_code varchar(6) null to opportunities; add checked_in_at datetime null and checked_out_at datetime null to applications. Fold into schema.sql.
2. When an opportunity is created, generate a random 6-character alphanumeric check_in_code. Show it only to admins (opportunity detail and a printable view).
3. POST /api/applications/:id/check-in and /check-out: volunteer submits the code for their accepted application on the day of the shift; validate code, window (from 1h before start to end of day), and ownership. Store timestamps.
4. When both timestamps exist, pre-fill a volunteer_hours entry (status pending as today) from the actual duration, rounded to 15 min. Manual logging stays available for shifts without check-in.
5. Volunteer UI: on my-applications, an accepted application on shift day shows a "Check in" field; after check-in it shows "Check out". Badge verified hours differently on my-hours.
6. Admin UI: approve-hours shows a "verified by check-in" marker so admins can fast-approve those.
7. Tests: wrong code rejected, out-of-window rejected, duration calculation and rounding, verified marker set.
```

---

## Prompt 7 - Bulk messaging

```
Add admin bulk messaging to this Express/MySQL volunteer app using the existing nodemailer email service.

1. POST /api/admin/messages (admin only): subject, body, and a filter object (profile status, skill substring, min approved hours, applied-to-opportunity id). Resolves recipients server-side, sends individually (no CC leaks), and returns sent/failed counts. Rate-limit to protect the SMTP account and batch sends with a small delay.
2. Migration database/00X_add_messages.sql: table admin_messages (id, admin_id, subject, body, filter_json, recipient_count, created_at) as a send log. Fold into schema.sql.
3. Admin UI: new page frontend/pages/admin/messages.html with filter controls, a live recipient count (GET endpoint that returns count for a filter without sending), subject/body, confirm dialog showing the count before send, and a history table of past sends.
4. Plain-text email using the existing email template style, with an unsubscribe note pointing at contacting the shelter.
5. Tests: filter resolution (each filter alone and combined), no send when recipient count is 0, log row written.
```

---

## Prompt 8 - Public opportunities page + iCal

```
Add public recruitment features to this Express/MySQL volunteer app. Everything is currently behind login.

1. GET /api/public/opportunities: no auth, returns open future opportunities with title, description, date, time, location, spots remaining. Exclude admin-only fields (check_in_code etc). Cache for 60s in memory. Rate-limit generously.
2. Public page frontend/pages/opportunities.html: served without auth, lists open shifts with a "Sign up to apply" button linking to register. Reuse existing PicoCSS styling. Link it from the login/register pages.
3. iCal: GET /api/public/opportunities.ics returns a valid VCALENDAR of open shifts (generate by hand, no new dependency; escape commas/semicolons/newlines per RFC 5545). Also GET /api/my-shifts.ics?token=... : per-user feed of accepted upcoming shifts, using a per-user random feed token stored via migration database/00X_add_ical_token.sql (fold into schema.sql), shown on the volunteer dashboard as a copyable "subscribe in your calendar" URL.
4. Add "Add to calendar" (.ics download) per accepted application on my-applications.
5. Tests: public endpoint hides admin fields and closed/past shifts, ics output parses (basic structure assertions), feed token required and wrong token 404s.

Do not weaken auth on any existing endpoint.
```

---

## Prompt 9 - Impact profile polish

```
Upgrade the volunteer dashboard on this Express/MySQL volunteer app into a shareable impact profile. Badges from approved hours/shifts already exist in models/Badge.js.

1. Extend the volunteer dashboard: total approved hours, shifts completed, current streak (consecutive calendar months with at least one approved shift), badges earned with progress toward the next badge.
2. GET /api/stats/me powering it, computed with the existing stats controller patterns.
3. A "share my impact" card: renders the stats into a canvas image the volunteer can download (vanilla JS, no new dependencies), branded ShelterLink.
4. Admin reports page: add a simple leaderboard (top volunteers by approved hours, current year) and month-by-month hours chart using a small inline SVG bar chart, no chart library.
5. Tests: streak calculation across month boundaries and gaps, next-badge progress math.
```

---

# Round 2 - paid-tier features

## Prompt 10 - Qualifications and training with expiry (needs Prompt 4)

```
Add a qualifications system to this Express/MySQL volunteer app. This is how paid tools gate shifts behind training (e.g. "Dog Handling Induction", "Manual Handling").

1. Migration database/0XX_add_qualifications.sql: tables qualifications (id, name, description, validity_months int null meaning never expires) and volunteer_qualifications (id, user_id FK, qualification_id FK, awarded_at date, expires_at date null, awarded_by FK users, unique user+qualification). Junction opportunity_qualifications (opportunity_id FK, qualification_id FK). Fold into schema.sql.
2. Admin: CRUD for qualifications (new page frontend/pages/admin/qualifications.html), and on the volunteers page an "award qualification" action that computes expires_at from validity_months.
3. Opportunity create/edit: multi-select of required qualifications.
4. Application gating in applicationController: applying to an opportunity that requires qualifications the volunteer lacks (missing or expired) is rejected with a clear message listing what's missing. Browse-shifts shows a "requires: X, Y" tag and greys out unqualified shifts with the reason.
5. Expiry job (uses utils/scheduler.js): daily, email volunteers whose qualifications expire in 30 days, and again at expiry. Record in job_runs, idempotent via a last-notified marker column.
6. Volunteer dashboard: "my qualifications" card with expiry status.
7. Tests: gating on missing and on expired, expires_at calculation, expiry job selects the right rows only once.
```

---

## Prompt 11 - Custom profile fields

```
Add admin-configurable custom profile fields to this Express/MySQL volunteer app, like Better Impact's custom fields.

1. Migration database/0XX_add_custom_fields.sql: tables custom_fields (id, label, field_type enum('text','select','checkbox','date'), options_json, required tinyint, applies_to enum('profile'), sort_order, active tinyint) and custom_field_values (id, field_id FK, user_id FK, value text, unique field+user). Fold into schema.sql.
2. Admin page frontend/pages/admin/custom-fields.html: create, reorder, deactivate fields (never hard-delete once values exist).
3. Volunteer complete-profile page: render active custom fields dynamically after the built-in fields, validate required ones server-side in profileController, store values.
4. Admin volunteers page: show custom field values on the volunteer detail view; include them as columns in the CSV export.
5. Sanitise values with the existing xss/validator middleware patterns.
6. Tests: required custom field blocks profile submit, select validates against options, export includes columns.
```

---

## Prompt 12 - Waivers and documents

```
Add electronic waivers and document uploads to this Express/MySQL volunteer app.

1. Migration database/0XX_add_waivers.sql: tables waivers (id, title, body mediumtext, version int, active tinyint, requires_reacceptance tinyint, created_at) and waiver_acceptances (id, waiver_id FK, user_id FK, version, accepted_at, unique waiver+user+version). Table user_documents (id, user_id FK, filename, original_name, mime_type, size, uploaded_at, expires_at date null, label). Fold into schema.sql.
2. Admin waiver management page: create/edit waiver text (editing bumps version; if requires_reacceptance, volunteers must re-accept).
3. Volunteer flow: on login, if any active waiver is unaccepted at current version, show a blocking accept screen (scrollable text, checkbox, typed full name as signature). Store acceptance. Application submission re-checks server-side.
4. Documents: volunteers upload files (pdf/jpg/png, 5MB cap, multer, stored outside the web root with random filenames, served only through an authed download route that checks ownership or admin). Admins can view, label and set expiry (e.g. reference letters, parental consent).
5. Admin volunteers page shows waiver status and document list per volunteer.
6. Tests: unaccepted waiver blocks application server-side, version bump forces re-accept, upload rejects wrong mime/oversize, download route enforces ownership.
```

---

## Prompt 13 - Interests, tags and auto-matching

```
Add interest tags and opportunity matching to this Express/MySQL volunteer app, like Get Connected's auto-matching.

1. Migration database/0XX_add_tags.sql: tables tags (id, name unique), volunteer_tags (user_id, tag_id), opportunity_tags (opportunity_id, tag_id). Seed shelter-relevant tags: dogs, cats, small animals, cleaning, events, admin, transport, photography, fundraising. Fold into schema.sql.
2. Volunteer profile: pick interest tags (chips UI, vanilla JS). Admin opportunity form: tag the opportunity.
3. "Recommended for you" section on the volunteer dashboard: open future opportunities scored by tag overlap plus availability match (profile availability vs shift day/time), best 5 first. Plain SQL scoring, no ML.
4. Browse-shifts: filter by tag.
5. New-opportunity notifications: when an admin creates an opportunity, email volunteers whose tags overlap and whose profile is approved, max one digest per volunteer per day (batch via the scheduler if present, otherwise send inline capped at 200 recipients).
6. Tests: scoring order, availability match logic, digest de-duplication.
```

---

## Prompt 14 - Shift swaps and self-service cancellation rules

```
Add self-service shift changes to this Express/MySQL volunteer app.

1. Migration database/0XX_add_swap.sql: add cancellation_cutoff_hours int default 24 to opportunities; table swap_requests (id, application_id FK, requested_at, status enum('open','claimed','expired','cancelled'), claimed_by_application_id null). Fold into schema.sql.
2. Cancellation rules: volunteers can cancel an accepted application only up to cancellation_cutoff_hours before the shift; inside the window they must request a swap instead. Admins can always cancel.
3. Swap flow: volunteer opens a swap request; other approved volunteers who qualify for the shift (respect qualification gating if present) see it on browse-shifts under "cover a shift" and can claim it. Claiming transfers the accepted slot: the claimer gets an accepted application, the original is marked cancelled, both get emails, admin sees it in an activity note on the opportunity.
4. Waitlist integration if present: an open swap offers the slot to the waitlist first (oldest first, 12h to claim via emailed link) before appearing publicly.
5. Admin setting on the opportunity form for the cutoff.
6. Tests: cutoff enforcement, claim transfers slot atomically (transaction), waitlist priority, unqualified claimer rejected.
```

---

## Prompt 15 - Admin roles, audit log and GDPR tools

```
Harden the admin side of this Express/MySQL volunteer app for real multi-staff use in the UK.

1. Migration database/0XX_add_roles_audit.sql: add role enum('volunteer','staff','admin') to users replacing the current is_admin boolean (migrate existing values: admins stay 'admin'). Table audit_log (id, user_id, action varchar, entity_type, entity_id, detail_json, created_at, indexed on entity and user). Fold into schema.sql.
2. Permissions: 'staff' can manage opportunities, applications, and hours but cannot approve volunteer profiles, manage waivers/qualifications definitions, manage other admin accounts, or export data. 'admin' can do everything. Update the isAdmin middleware into requireRole(...roles) and apply per route. Frontend hides what the role can't do (server-side checks are the real guard).
3. Audit log: middleware records every mutating admin/staff action (who, what, when, before/after summary). Admin-only page with filters by user, entity and date.
4. GDPR tools (admin only): per-volunteer data export (JSON of profile, applications, hours, acceptances) and account erasure that anonymises the user row (name/email/phone replaced, keeps hours totals for reporting integrity) after a typed confirmation. Log both in the audit log.
5. Data retention: scheduled job (if scheduler present) or admin button to anonymise accounts inactive 3+ years, configurable via env var.
6. Tests: staff blocked from admin-only routes, audit rows written on mutations, erasure anonymises but preserves aggregate hours.
```

---

## Prompt 16 - Post-shift feedback and surveys (needs Prompt 4)

```
Add post-shift feedback to this Express/MySQL volunteer app.

1. Migration database/0XX_add_feedback.sql: table shift_feedback (id, application_id FK unique, rating tinyint 1-5, comment text null, flag_concern tinyint default 0, created_at). Fold into schema.sql.
2. Job (uses utils/scheduler.js), daily: for accepted applications whose opportunity date passed yesterday, email a feedback link (signed token, no login needed for the form but the token maps to the application). One email per application, tracked via a feedback_requested_at column.
3. Feedback form page: rating stars, optional comment, optional "something needs attention" flag. Submitting with flag_concern notifies all admins by email.
4. Admin page: feedback list with filters, average rating per opportunity and overall, concerns highlighted until marked handled (handled_at column, admin action).
5. Volunteer my-hours page can also link to leaving feedback for past shifts.
6. Tests: token validation, one-request-per-application, concern triggers admin email, averages math.
```

---

## Prompt 17 - Groups, community service and kiosk mode (needs Prompt 6)

```
Add group volunteering, community-service tracking and an on-site kiosk to this Express/MySQL volunteer app.

1. Migration database/0XX_add_groups_kiosk.sql: add volunteer_type enum('regular','community_service','corporate_group') default 'regular' to volunteer_profiles, and required_hours decimal null (community service targets). Table group_bookings (id, opportunity_id FK, group_name, contact_name, contact_email, size int, status enum('pending','confirmed','cancelled'), notes, created_at). Fold into schema.sql.
2. Group bookings: public form (linked from the public opportunities page if present) where a company/school requests a group slot for an opportunity; size counts against capacity only when an admin confirms. Admin page to confirm/decline with email notifications.
3. Community service: admins can set volunteer_type and required_hours on a profile; the volunteer dashboard shows progress toward required hours; the admin export gains a community-service report (volunteer, target, approved hours, completion date) suitable for probation/school paperwork.
4. Kiosk mode: /kiosk full-screen page for a tablet at the shelter. Admin unlocks it with their login once; it then shows today's shifts and accepted volunteers by first name + last initial; a volunteer taps their name and enters the shift check-in code (from the existing check-in feature) to check in/out. Auto-resets to the shift list after 10s. Session for the kiosk is a restricted flag that can only hit kiosk endpoints.
5. Tests: group size respects capacity on confirm, community service progress math, kiosk session cannot access admin APIs.
```
