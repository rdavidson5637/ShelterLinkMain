# Merge rehearsal: #17–#28 (+ #29)

**DO NOT MERGE this branch into main.** Merging deploys straight to production on Railway (`shelterlink.online`).

Throwaway branch: `rehearsal/merge-17-28`  
Base: `origin/main` @ `7a0d397`  
Worktree: `/Users/ryandavidson/otis-lanes/SL-REHEARSAL`  
Agent: cursor (LANE-SL)  
Date: 20 Nov 2026 (UK)

Agent-written code in the open PRs is unverified until Ryan reviews. This report proves mergeability and test greenness on a throwaway tree only.

## Order used

Merge commits only (`git merge --no-ff`). No squash, no rebase, no force-push. No prod/Railway migrations.

| Step | PR | Topic | Merge result | Tests after |
|---|---|---|---|---|
| 1 | #17 | Invite emails + accept | CLEAN | 614 pass |
| 2 | #18 | Suspended shelters | CONFLICT → resolved | 639 pass |
| 3 | #20 | Reactivate (+ 039) | CLEAN | 645 pass |
| 4 | #23 | Unknown slug fail-closed | CONFLICT → resolved | 648 pass |
| 5 | #19 | Public `/apply` (+ 040) | CONFLICT → resolved | 668 pass |
| 6 | #21 | Staff invites (stale base) | CONFLICT → resolved | 679 pass |
| 7 | #22 | Platform-queue tests | CLEAN | 695 pass |
| 8 | #24 | Main test coverage | CLEAN | 710 pass |
| 9 | #25 | A11y skip links | CONFLICT → resolved | 711 pass |
| 10 | #26 | Mobile 390px | CLEAN | 711 pass |
| 11 | #27 | Empty/error states | CONFLICT → resolved | 712 pass |
| 12 | #28 | Type scale | CLEAN | 712 pass |
| 13 | #29 | Admin/volunteer type polish | CLEAN | 712 pass |

Final: **712 pass / 0 fail**. `node --check server.js` OK. No separate lint/typecheck/build scripts in this repo.

## Conflicts and how they were resolved

### #18 after #17
| File | Choice |
|---|---|
| `controllers/platformController.js` | Keep **both** import sets: #17 `shelterProvision` / `inviteDelivery` / `accountLookup` **and** #18 `forgetShelter`. |
| `docs/platform-owner.md` | Keep #17 invite URL wording (`/invite#<token>`). Append #18 suspend section. Drop the “until PR6” / no-accept-page sentence. |

### #23 after #18
| File | Choice |
|---|---|
| `middleware/shelter.js` | Keep #18 comment (unknown **or suspended** never fall back). Use #23’s `shelterIdFromSlug(slug)` call (already active-only). |
| `server.js` | Keep #18 `activeShelterPage` for `/s/:slug*` (covers suspended + unknown). Comment mentions both. |
| `test/publicSlug.test.js` | Take #23 stronger 404 body / no-tenant-query assertions + unknown group-booking test. Keep #18 assertion message about never falling back to the session. |

### #19 after #17/#23
| File | Choice |
|---|---|
| `.env.example` | Keep **both** invite rate-limit vars and apply/pending caps. |
| `docs/platform-owner.md` | `/apply` section first, then invite section. Drop “until PR6” staging heading. |
| `middleware/rateLimiter.js` | Keep **both** invite limiters and `shelterApplyLimiter`. |
| `server.js` | Keep **both** `/invite` and `/apply` routes. |
| `validation/bodies.js` | Keep **both** invite schemas and `shelterApplication`. |

### #21 (stale stacked base)
Full head merge worked. Only three conflicts, all trivial:

| File | Choice |
|---|---|
| `docs/platform-owner.md` | Whitespace. |
| `server.js` | Whitespace. |
| `validation/bodies.js` | Keep `staffInvite` schema from #21. |

**Note:** Unique feature commits that matter are `0cec191`, `d41440b`, `ffd5eb6`. Cherry-pick was **not** required; merging the stale head after #17–#20/#19/#23 was enough. Retarget #21 to main before a real merge so the GitHub diff is honest.

### #25 after #24
| File | Choice |
|---|---|
| `test/htmlHead.test.js` | Keep **both** tests: `lang=en` (#24) and skip-link (#25). |
| `frontend/invite.html`, `apply.html`, `pages/admin/team.html` | Pages from #17/#19/#21 lacked skip links. **Added** `#25` skip-link + `main#id` so the a11y contract still holds. Ryan should expect the same backfill when merging for real, or fold it into an accept-polish follow-up. |

### #27 after #25
| File | Choice |
|---|---|
| `frontend/js/public/opportunities.js` | Take #27 empty/error helpers (keeps #25 `aria-busy`). |
| `frontend/pages/error/403.html`, `404.html`, `500.html` | Take #27 empty-state markup; **keep** #25 skip-link + `main#id`. |

### Clean merges (no conflicts)
#17, #20, #22, #24, #26, #28, #29.

## Migrations Ryan must run (and when)

| Migration | When | Notes |
|---|---|---|
| **039** `database/039_platform_audit_reactivate.pg.sql` | **After #20 is on main, before using Reactivate in prod** | Extends `platform_audit` check for `shelter.reactivated`. Needs Ryan’s explicit yes. Not run in this rehearsal against prod/Railway. |
| **040** `database/040_shelter_applications_pending_unique.pg.sql` | **After #19 is on main, before relying on `/apply` uniqueness under load** | Partial unique indexes on pending applications. Needs Ryan’s explicit yes. Not run here against prod. |

Do **not** run these on production from this lane. Local/throwaway DB only if a future test needs them; this rehearsal’s suite stayed green without applying them to prod.

## Risks

1. **Main deploys to production on push**, without waiting for CI. Each real merge is a live release. Prefer merge commits; do not squash #17 into a stack that #21 assumes.
2. **#18 vs #23** share slug middleware. Wrong resolution re-opens Assisi fallback for unknown/suspended public slugs (live P1). Rehearsal resolution keeps fail-closed + suspend-aware.
3. **#21 base is stale.** GitHub’s file list includes older PR work. Retarget to main after #19; trust the unique commits, not the stacked diff.
4. **#25 skip-link contract** will fail on `invite.html` / `apply.html` / `team.html` unless those pages get the same backfill done here.
5. **CSS stack (#26–#29)** mostly auto-merged here. If order changes, keep mobile rules, empty-state blocks, type tokens, and admin token mappings together in `custom.css`.
6. **Invite email** and **charity apply** need env configured (names below). Approving a shelter on prod without invite delivery leaves an unused invite row.
7. Treat all of this as **unverified agent code** until Ryan has checked behaviour on a non-prod path.

## Go-live checklist for Ryan

### Before any merge
- [ ] Confirm Railway production is the intended target (main → `shelterlink.online`).
- [ ] Prefer **Create a merge commit**, never squash for #17–#21.
- [ ] Merge main **into** feature branches to resolve conflicts (never rebase public PR heads).

### Env names only (no values)
Invite / email (for #17):
- `APP_URL`
- `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM`
- `ADMIN_EMAIL` (optional staff inbox; falls back to `EMAIL_USER`)
- `RATE_LIMIT_INVITE`, `RATE_LIMIT_INVITE_CHECK`, `RATE_LIMIT_INVITE_PAGE`

Apply form (for #19):
- `RATE_LIMIT_SHELTER_APPLY`
- `SHELTER_APPLY_MAX_PENDING`
- `SHELTER_APPLY_MAX_PENDING_PER_EMAIL`

Railway: same names as in `.env.example` for the above; do not change region without Ryan’s OK.

### Suggested live merge sequence + smoke
1. Merge **#17** → smoke: `/invite` page loads; approve-path email only on staging if available.
2. Merge **#18** (resolve as above) → smoke: suspended shelter public slug 404; staff get `shelter_suspended`.
3. Merge **#20** → **run 039** (Ryan yes) → smoke: Reactivate restores access.
4. Merge **#23** (resolve as above) → smoke: unknown `/s/not-a-real-slug` 404, no Assisi board.
5. Merge **#19** (charity; Ryan) → **run 040** (Ryan yes) → smoke: `/apply` submits; queue shows row.
6. Retarget + merge **#21** → smoke: admin Team invites page.
7. Merge **#22**, **#24** anytime relative to the stack.
8. Merge **#25** (backfill skip links on invite/apply/team) → **#26** → **#27** → **#28** → **#29**.
9. After each merge: hit `/healthz` or `/api`, login, one public board page, one admin dashboard page at 390px if UI changed.

### Never from this lane
- Merge to main, force-push, approve shelters on prod, run 039/040 on prod, change Railway staging/region.
