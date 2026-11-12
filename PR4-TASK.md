# ShelterLink PR4 — charity register adapters (CCEW + CCNI first)

Repo cwd: ~/otis-dispatch/ShelterLinkMain
**Base branch: `main` (PR #14 already merged @9a69e12).** Open PR against main. Do **not** merge this PR. Do **not** touch Railway/prod DB or invent API keys.

## Locked (Ryan)
- Approval gate stays: Ryan one-click before any shelter goes live
- Launch jurisdictions: **NI (CCNI) + England & Wales (CCEW) first**. OSCR + CRA can be stubbed/scaffolded but not required live this PR
- URLs stay path/slug; no subdomains
- Never accept client `shelter_id`
- No client emails/DMs; no inventing privacy/DPA prose

## This PR only (brief §9 item 4 + §6)
1. **`services/charityRegister/`** adapters on top of existing `formats.js` from #14:
   - `index.js` dispatch by regulator
   - `ccew.js` — Charity Commission E&W Register API client (mocked HTTP in tests). Env: `CCEW_API_KEY` (name only in check-prod; do not invent a key)
   - `ccni.js` — NI path: CSV/cache import approach (no documented API). Prefer a `charity_register_cache` global table + import script/job skeleton that reads a CSV; hand-check path OK. Env names only where needed
   - `oscr.js` / `cri.js` — thin stubs returning “not configured for launch” / clear error, OR minimal structure with mocked tests — do not require live keys
   - Each adapter returns `{found, name, status, removedAt, source, checkedAt}` shape from the brief
2. **`charity_register_cache`** global table if needed for CCNI/CRA CSV (migration **037** so #14 stays untouched). Revoke from `shelterlink_tenant`.
3. **`scripts/check-production.js`** (or existing check-prod): add env name checks for `CCEW_API_KEY` (and `OSCR_API_KEY` if stubbed). Do not require them set in CI unit tests.
4. **Mocked unit tests** for CCEW + CCNI paths; format validators stay in #14. `npm test` green.
5. Register lookup is evidence only — never a hard identity proof. If API down: document pending/unverified behaviour for later PR6.

## Out of scope
Platform owner UI (PR5), `/start` apply+invite (PR6), shelter settings/suspend (PR7), emails, merging anything, running migrate on prod, inventing Assisi privacy text.

## Done when
- PR open against `main`
- Title like `feat: charity register adapters (CCEW + CCNI)`
- Body cites brief §6/§9 item 4, follows merged #14
- Write PR URL to `~/otis-dispatch/shelterlink-pr4-result.txt`

Investigate the repo; match existing service/test style. Prefer small commits.
