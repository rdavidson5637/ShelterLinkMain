# ShelterLink PR2 — Claude Code / Antigravity paste

Repo: `rdavidson5637/ShelterLinkMain`.
**Base this PR on** `fix/brand-where-id-slug-helper` (open PR #12) so you already have `shelterIdFromSlug`. After Ryan merges #12, rebase onto `main` (or retarget the PR base). Do **not** merge #12 yourself.
Open a focused PR when done. Run `npm test` before pushing.

## Depends on PR1 (#12)
Already landed on that branch (do not redo):
- Brand queries use `WHERE id = ?` via `currentShelterId()` / Assisi fallback
- `shelters` in `schema.pg.sql`
- `shelterIdFromSlug(slug)` in `middleware/shelter.js` (cached; not wired to routes yet)
- Note: no `status` column yet — “active” means the row exists; leave the comment that marks where the approval filter will go later

## Ryan decisions (locked — do not reopen)
- Every new shelter needs Ryan approval before live (later PRs — no applications UI here)
- Launch regulators later: NI + England & Wales first
- Separate `platform_owners` account (later PR)
- Draft legal templates later for Ryan review — **not this PR**
- URLs: `/join/<slug>` and `/s/<slug>/...` — no subdomains
- No client emails/DMs/posts

## This PR only (slug-aware public + register)
Wire the helper from PR1. Outcomes, not a line-by-line patch — investigate the repo.

1. **Resolve public / brand / group-booking by slug**
   - `controllers/publicController.js`, `controllers/groupBookingController.js`, `controllers/brandController.js` (and any shared helpers they use): when a shelter slug is present (query `?shelter=`, path `/s/:slug/...`, or the route’s slug param), resolve with `shelterIdFromSlug`. Unknown / missing slug → keep today’s Assisi fallback via `assisiShelterId()`.
   - Still use explicit `WHERE id = ?` for brand/logo (already in PR1). Never take a client-supplied `shelter_id`.
   - Public opportunities, ICS, and group booking for slug B must never return or accept shelter A rows. Cache keys must include the resolved shelter id.

2. **Volunteer register by slug**
   - Add `/join/:slug` (and keep plain `/register` → Assisi for backwards compatibility).
   - `controllers/authController.js`: accept `shelter_slug` in the body (name must stay `shelter_slug`, **not** `shelter_id`, so `requestCarriesShelterId` still passes). Resolve server-side with `shelterIdFromSlug`. Rename `insertAssisiUser` → `insertUserForShelter(id)` (or equivalent) and insert with that shelter id.
   - Unknown slug → 404 (or clear validation error); do not silently fall through to Assisi on `/join/:slug`.
   - `frontend/register.html`: read `?shelter=` / `/join/:slug` and show that shelter’s brand (name/logo from the public brand API).

3. **Static Assisi strings (public/register surfaces only)**
   - Remove hard-coded “Assisi” from static copy/meta on public + register surfaces listed in the self-serve brief B6 where the page is now slug-aware: e.g. `frontend/register.html`, `frontend/index.html`, `frontend/pages/opportunities.html`, `frontend/public/manifest.webmanifest`. Prefer generic “ShelterLink” or brand-from-API. Leave deep privacy/retention Assisi-specific policy work for later PRs — do not invent privacy text.

4. **Tests**
   - Extend `test/tenantIsolation.run.js` (and unit tests in the existing style) with a two-shelter scenario: public brand / opportunities / ICS / group-booking and register via slug B never touch shelter A.
   - Cover: no-slug → Assisi; known slug → that shelter; unknown `/join/:slug` → error; `shelter_id` in request still rejected.

## Out of scope (stop if you start these)
`/start`, applications, migration 036, charity register APIs, platform owner UI, invites, suspend, admin shelter settings, ShelterManager, emails, inventing DPA/privacy template prose, merging PR #12.

## Done when
- Branch + PR opened (stacked on #12 or on `main` after #12 merges)
- Title like: `feat: slug-aware public brand, opportunities, and /join/:slug`
- Description cites the four bullets above and links #12
- `npm test` green
- Diff reviewable; prefer small commits

Investigate the repo yourself; these are outcomes.
