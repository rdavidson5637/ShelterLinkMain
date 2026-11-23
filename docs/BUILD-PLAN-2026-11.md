# ShelterLink build plan

23 November 2026 (Europe/London). Written after Ryan answered the audit planning questions. Nothing in this document is a merge or a production migration.

Source audit: [ShelterLink audit and feature plan](https://cursor.com/canvas/store-8dcd85f7-493f-407d-b343-7a8a29b07138/dbaed8bc-adb3-474f-87bc-96fb85659ccd) on main at `535db72`.

## Ryan's decisions

- Assisi is likely first, but not until the new year. Build as much as possible before then.
- ShelterLink stays free for charities.
- Booking approval is a per-shelter setting: either every booking needs approval, or trusted volunteers book instantly and the waitlist auto-fills.
- Minimum age is per shelter. Guardian consent is required for under-18s when that shelter allows minors.
- SMS will be discussed with the charity later. Build the reminder and notification framework with email and push only. Leave SMS behind a disabled provider interface. No Twilio account and no SMS cost.
- Refresh self-serve pull requests #17 to #21 onto current main now (#18 conflicts in four files since #23). Keep migrations 039 and 040 on those branches only. Do not apply them to production.
- Give ShelterLink a full human-designed redesign rather than polishing draft #31. No identical rounded cards, icon or emoji grids, gradient blobs, or filler copy. Editorial, characterful type, a real grid, and real copy. Start with a written design brief in this repo, with references from well-designed charity and booking products.
- A read-only live-database RLS check is approved: `pg_policies` and `pg_class.relrowsecurity` only. No writes, no migrations, never print connection strings or secrets.

## Hard rules (every lane, every task)

- Never merge a ShelterLinkMain pull request. `main` deploys to production on Railway.
- Never push to `main`. Never force-push to `main`.
- No production migrations. New migration files may exist on a feature branch and its PR, but they must not be applied to the live database.
- Do not approve shelters.
- No Railway staging changes without Ryan.
- Do not contact anyone (including charities, Kathy, or Grace).
- Do not invent secrets, Formspree IDs, or other identifiers. Never read or print tokens or connection strings.
- Each task gets its own branch and a PR against `main`, titled or marked "Do not merge without Ryan". Tests must be green (`npm test` and `npm run test:security`).
- Claim the task on rdev-coord and take the lock file before starting. Release or mark done when finished.
- Day build lanes for other products stay paused. This work is ShelterLink only.

## Lane guards (do not loop or rerun work)

These rules are enforced by `~/otis-lanes/run-lane-sl.sh` and `~/otis-lanes/sl-health.sh`, with status under `~/otis-lanes/status/`.

1. Every task has a unique ID (tables below) and a done marker at `~/otis-lanes/status/done/<TASK-ID>`.
2. A lane never starts a task that already has a done marker, or that already has an open PR for its branch.
3. Retries are capped at 2 per task. After that the runner writes `~/otis-lanes/status/blocked/<TASK-ID>` and moves on.
4. If a lane has made no new commit and no new log progress for 45 minutes, the health watcher kills that tmux session and the runner starts the next task (the stalled one is retried later if attempts remain).
5. Two lanes must not take the same task. The runner claims it on rdev-coord and writes `~/otis-lanes/status/locks/<TASK-ID>.lock`.
6. Each running lane keeps `~/otis-lanes/status/<LANE>.json` with current task, started time, last progress, attempts, branch, and state, so an hourly check can verify health.

Dependencies and likely file ranges are listed on each task so parallel lanes stay off the same files.

## Lanes

Three tmux lanes, each with its own worktree from current `origin/main`, created from a fresh clone at `~/otis-lanes/work/ShelterLinkMain`. Do not use the Desktop/Software Projects worktrees: that repository's object pack is damaged.

| Lane | Tmux | Worktree | Now order | Then |
| --- | --- | --- | --- | --- |
| Auth and small public fixes | `D-SL-A` | `~/otis-lanes/day/SL-A` | SL-NOW-01, SL-NOW-07 | SL-NEXT-07, SL-NEXT-06 |
| Safeguarding and booking policy | `D-SL-B` | `~/otis-lanes/day/SL-B` | SL-NOW-02, SL-NOW-03 | SL-NEXT-04 |
| Reports and launch paperwork | `D-SL-C` | `~/otis-lanes/day/SL-C` | SL-NOW-04, SL-NOW-05 | SL-NEXT-05 |

`SL-PLAN-01` (this document) and `SL-NOW-06` (RLS check) are done or attempted by the coordinator, not by a lane. `SL-NEXT-01` (PR #17–#21 refresh) is sequential and should run only when a lane is free and no other lane is editing those files. `SL-NEXT-02` (design brief) then `SL-NEXT-03` (redesign) should run as one lane after the Now P1s, and must not polish draft #31.

When a lane finishes its current task, the runner starts the next eligible task for that lane. It does not repeat a done task.

## Now

Audit P1s and the homepage town bug, so as much as possible is ready before a new-year Assisi launch.

### SL-PLAN-01 — this build plan

Branch: `docs/sl-build-plan-2026-11`. Coordinator only. Deliverable is this file and the lane queue.

### SL-NOW-01 — 30-day remember-me for volunteers only

- **Why:** Everyone is signed out after one hour of idle time, including volunteers on the phone app (`server.js` about lines 122–131).
- **Do:** Keep staff and admin sessions at 1 hour. Give volunteers a 30-day remember-me session on their own device (explicit opt-in on login is fine). Do not extend kiosk sessions. Tests for cookie lifetime by role.
- **Likely files:** `server.js`, session helpers, login form/controller, `middleware/auth.js` only if needed, tests. Avoid `applicationController.js` and volunteer profile models.
- **Depends on:** nothing.

### SL-NOW-02 — under-18 rules

- **Why:** Date of birth is stored but unused. Ryan: minimum age is per shelter, with guardian consent when the shelter allows minors.
- **Do:** Per-shelter minimum age. When a shelter allows under-18s, collect and record guardian consent before they can book. Block booking if the volunteer is under the shelter minimum or consent is missing. Do not invent a single global age. Migration files stay on the branch only.
- **Likely files:** shelter settings, `models/VolunteerProfile.js`, booking eligibility, consent UI, a new migration on the branch, tests.
- **Depends on:** nothing. Must finish before SL-NOW-03 if both would migrate the same shelter-settings table; this lane owns those settings first, then starts SL-NOW-03.

### SL-NOW-03 — per-shelter approval, instant booking, waitlist auto-fill

- **Why:** Every booking, including a waitlist promotion, currently waits for staff (`applicationController.js`).
- **Do:** Per-shelter setting: (a) all bookings need approval, or (b) trusted volunteers book instantly and the waitlist auto-fills to confirmed, not back to pending. Define "trusted" clearly in the PR (for example a shelter flag or completed-hours threshold — do not invent a policy Ryan did not state; default to an explicit staff-granted trusted flag if unsure). Tests for both modes.
- **Likely files:** `controllers/applicationController.js`, shelter settings, waitlist promotion, tests.
- **Depends on:** SL-NOW-02, so shelter-settings migrations do not collide.

### SL-NOW-04 — funder impact report

- **Why:** High-value P1-adjacent report for grant bids and trustees. One-click hours, volunteers, walks, and animals helped, by date range, as PDF and CSV.
- **Do:** Staff/admin-only report. Use real field names already in the database. No invented statistics. A local unpushed `features/impact-report` worktree exists under a damaged git directory — start fresh from `origin/main` and do not copy from that pack.
- **Likely files:** new report route/views, queries, tests. Avoid session and booking-approval files.
- **Depends on:** nothing.

### SL-NOW-05 — launch paperwork drafts (docs only)

- **Why:** No DPIA yet. A backup-restore runbook exists (`docs/BACKUP-RESTORE.md`, `docs/runbooks/backup-and-restore.md`) but the restore drill table is still "Not done".
- **Do:** Draft a DPIA template in `docs/` (AccessNI / Article 10 in scope, for the charity to sign — we do not contact them). Tighten the backup-restore runbook so someone can run the drill later on a scratch copy. Do not run a restore against production. Do not invent controller legal wording as if it were signed off.
- **Likely files:** `docs/` only (new DPIA, edits to the runbook).
- **Depends on:** nothing.

### SL-NOW-06 — read-only production RLS check

Coordinator only. Confirm tenant policies exist and `relrowsecurity` is enabled, using only read queries (`pg_policies`, `pg_class.relrowsecurity`). Record the result in `docs/tenancy/rls-check-2026-11-23.md` without secrets. No writes, no migrations.

### SL-NOW-07 — homepage "Belfast for every shelter"

- **Why:** `frontend/index.html` line 39 says "Browse open shifts in Belfast" for every shelter.
- **Do:** Use the shelter record's town or drop the town. Do not invent a town. Keep the change small and scoped; the later redesign will replace the page.
- **Likely files:** `frontend/index.html` and whatever already supplies public brand/town, plus a test if one exists.
- **Depends on:** nothing. Do not overlap the later redesign branch.

## Next

### SL-NEXT-01 — refresh pull requests #17 to #21

Rebase or resolve onto current `origin/main`. #18 conflicts in `middleware/shelter.js`, `server.js`, `test/publicSlug.test.js`, and `test/tenantIsolation.run.js` since #23 — keep #23's fail-closed rule. Migrations 039 and 040 stay on those branches only. Do not merge. Do this when no other lane is editing those four files. Sequential, one operator.

### SL-NEXT-02 — written design brief

Write `docs/DESIGN-BRIEF.md` in the repo. References from well-designed charity and booking products (not generic AI template galleries). Type pairing, grid, colour (per-shelter later; do not invent a new Assisi palette unless copying what the sanctuary already uses), photography, copy voice, and the banned patterns (identical rounded cards, icon/emoji grids, gradient blobs, filler copy). Draft #31 is not the starting point.

### SL-NEXT-03 — full redesign

Implement the brief in small PRs (public and volunteer surfaces first). One coherent stylesheet direction, not a third layer over Pico and `custom.css` and #31. Real grid, characterful type, real copy. Do not polish #31 in place.

### SL-NEXT-04 — training-module gates

Training with a pass mark that can gate shifts (for example dog walking level 1), beyond today's qualification records.

### SL-NEXT-05 — QR check-in

Poster QR check-in on the volunteer's own phone, alongside the existing kiosk. Use a cryptographic source for codes, not `Math.random`.

### SL-NEXT-06 — staff two-factor sign-in

Optional TOTP for admin and staff, who can see AccessNI data. Not required for volunteers in this task.

### SL-NEXT-07 — notification framework (email and push only)

Reminders and urgent-cover notifications through email and the existing push path. SMS sits behind a disabled provider interface so it can be enabled later. No Twilio, no SMS provider account, no SMS cost.

## Later (not scheduled in these lanes)

Vendor CDN checksums, `isAuthenticated` returning 401 when the user row is missing, object storage before a third shelter, register-page form wording, rate-limit/job dedupe before replicas, mail sync, mileage expenses, membership table for one login across sanctuaries.

## Open pull requests to leave alone

Do not merge any of these. Do not use draft #31 as the redesign base.

- #17 to #21 — self-serve stack, refresh in SL-NEXT-01
- #31 — design-pro polish, superseded by SL-NEXT-02 and SL-NEXT-03
