# Secrets and repo hygiene

Date: 2026-10-22. No git history was rewritten.

## Result

No production database password, session secret, SMTP password, or API key was found in git history. Nothing is marked "rotate this".

A local `.env` exists, is listed in `.gitignore` (lines 14-16 and 67-69), and `git ls-files` does not track it. `git log --all -- .env` is empty. That file holds a real `DATABASE_URL`, `SESSION_SECRET`, `FEEDBACK_TOKEN_SECRET`, and `ADMIN_REGISTRATION_KEY`. Those values are not in this report. Do not commit `.env`.

## How the search was done

- Working tree: pattern search for connection strings, `AKIA`, `sk_live_`, private keys, and env assignments. Frontend JS only reads passwords from form fields and sends them to the API. `frontend/js/config.js` sets the API URL from `window.location.origin`. It does not embed server secrets.
- History: `git grep` across all 103 commits for `postgresql://`, `SESSION_SECRET=`, `EMAIL_PASS=`, `ADMIN_REGISTRATION_KEY=`, `BACKUP_ENCRYPTION_KEY=`, `WEB_PUSH_VAPID_PRIVATE_KEY=`, `supabase.co`, `AKIA`, `sk_live_`, and private-key headers. Early commits contain a committed `.npm-cache` directory, which makes a full-tree grep stall, so those commits were searched on source paths (config, server, scripts, docs, database, `.env.example`) instead of the cache.
- `git log --all --name-only` for `.env` returns only `.env.example`.

## Findings

| Where | What | Action |
|---|---|---|
| `.env` (local only) | Real Supabase URL and app secrets. Not in git. | Leave untracked. Not "rotate this" from the repo scan. |
| `.github/workflows/ci.yml` | `postgresql://postgres:postgres@127.0.0.1:5432/shelterlink_tenant_test` | Local CI service password. Not a production secret. |
| `database/seed.pg.sql` and `database/seed.sql` | Comments name the seeded demo passwords. Hashes are in the INSERT rows. | Left in place. This pass does not change the database. |
| `controllers/publicConfigController.js` (before this pass) | Demo passwords were hardcoded and returned by `GET /api/public/config` whenever `NODE_ENV` was not `production`. | Now read from `DEMO_ADMIN_EMAIL`, `DEMO_ADMIN_PASSWORD`, `DEMO_VOLUNTEER_EMAIL`, `DEMO_VOLUNTEER_PASSWORD`. Unset means no accounts are returned. Production still returns none. |
| `scripts/smoke-test.js` (before) | Fell back to the seeded admin password on localhost. | Now exits if `SMOKE_ADMIN_PASSWORD` is unset. |
| `scripts/setup-db.js` (before) | Printed the seeded passwords after `db:reset`. | Now points at `database/seed.pg.sql`. |
| Commit `fcfcc62` (`config/database.js`, `.env.example`) | Hardcoded local MAMP `DB_USER` / `DB_PASSWORD` of `root` (4 characters). `SESSION_SECRET` in that `.env.example` was the `change_me` placeholder. | Not in current code. Current `config/database.js` reads `process.env`. Local MAMP default, not a hosted database password. Not marked rotate. |
| `.npm-cache/` | Present in the MAMP baseline commits (`a801170`, `60db656`, `fcfcc62`). Not in the current tree. `.gitignore` already ignores `.npm-cache/`. | Left in history. Do not rewrite history to delete it. |

No SMTP password, VAPID private key, or backup encryption key was found with a non-placeholder value in git.

## What the browser receives

- `GET /api/push/vapid-public-key` returns the VAPID public key only (`controllers/pushController.js` lines 15-21). The private key stays in env (`utils/pushService.js`).
- `GET /api/public/config` returns demo passwords only when the demo env vars are set and `NODE_ENV` is not `production`.
- Session cookie remains `httpOnly` (`utils/sessionCookie.js`). The session secret is not sent to the client.

## Startup checks

Already present: production refuses to start when `SESSION_SECRET`, `ADMIN_REGISTRATION_KEY`, or `APP_URL` is missing, short, or a known placeholder (`utils/validateEnv.js`). `SESSION_SECRET` is also required outside production (`server.js`).

Added: production now also refuses to start when `DATABASE_URL` is blank. Local development can still use `DB_HOST`, `DB_USER`, `DB_PASSWORD`, and `DB_NAME`.

## `.env.example`

Updated so it names every variable the app, backup script, migrate script, shelter-create script, smoke test, and service-worker version lookup read. Placeholder values only. `UPLOAD_DIR` is in the local `.env` and is not read by current JS, so it is not listed.
