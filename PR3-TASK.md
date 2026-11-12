# ShelterLink PR3 — migration 036 + format validators

Repo cwd: ~/otis-dispatch/ShelterLinkMain (already on main with #12+#13).
Base: `main` at sha including #13 merge (`7879230` or later). Branch: `feat/migration-036-format-validators`.
Open a PR against `main`. Do **not** merge. Do **not** touch Railway/Vercel/prod DB.

## Locked (Ryan)
- Every new shelter needs Ryan approval before live
- Launch regulators later: NI + England & Wales first (adapters are PR4 — not this PR)
- Separate `platform_owners` table (schema only this PR; UI is PR5)
- URLs: `/join/<slug>` and `/s/<slug>` — no subdomains
- Never accept client `shelter_id`; reuse existing tenancy model
- No client emails/DMs

## This PR only (§9 item 3 of self-serve brief)
1. **Migration `database/036_self_serve_shelters.pg.sql`** per brief §5 "Data model":
   - `shelters` add: `charity_regulator` (enum/text check `ccew|oscr|ccni|cri`), `charity_number`, `charity_register_name`, `charity_checked_at`, `status` (`active|suspended`, default `active` for existing rows including Assisi), `privacy_contact_email`, `primary_colour` (optional hex). Unique `(charity_regulator, charity_number)` where both set.
   - Global `shelter_applications` (no RLS to `shelterlink_tenant`): id, shelter_name, desired_slug, regulator, charity_number, register_snapshot JSONB, contact_name, contact_email, status `pending|approved|rejected`, decided_by, decided_at, reason, created_at.
   - Tenant `admin_invites`: id, shelter_id FK, email, token_hash, role (`admin|staff`), expires_at, used_at, created_by — add to TENANT_TABLES / RLS pattern like 033.
   - `platform_owners(user_id)` separate table (recommended in brief), revoked from `shelterlink_tenant`.
   - Mirror into `schema.pg.sql` / `TENANT_TABLES` as the repo already does for other migrations.
   - Assisi backfill: existing shelter id 1 stays `status=active`; new columns nullable where needed so Assisi keeps working.
2. **`services/charityRegister/formats.js`** (new) — offline format validators only from brief §6 table:
   - CCEW: 6–7 digits (+ optional subsidiary suffix)
   - OSCR: `SC` + 6 digits
   - CCNI: `NIC` + 6 digits (reject older XN/XR)
   - CRA/IE: RCN 8 digits (e.g. 20xxxxxx) — not CHY
   - Export clear validate helpers + regulator-specific error messages. No HTTP/API calls in this PR.
3. **Unit tests** for formats.js + migration/schema expectations in existing style. `npm test` green.

## Out of scope (stop)
Register HTTP adapters / CSV import (PR4), platform owner API/UI (PR5), `/start` apply+invite flow (PR6), admin shelter settings/suspend UI (PR7), emails, Formspree, inventing privacy/DPA prose, merging any PR, production migrate.

## Done when
- PR open against `main`, title like `feat: migration 036 self-serve shelters + charity format validators`
- Description cites brief §5 data model + §6 formats; links #12 and #13
- `npm test` green; small reviewable commits
- Write PR URL to `~/otis-dispatch/shelterlink-pr3-result.txt`

Investigate the repo yourself; match existing migration/test style. Prefer small commits.
