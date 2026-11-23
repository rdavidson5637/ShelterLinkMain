# Post-deploy smoke check

After a deploy to production (or a preview you care about), confirm the app is
up, the database answers, and the public surfaces still respond. This check is
read-only: it does not register users, create shifts, or send mail.

## Quick check

From the repo root:

```bash
npm run smoke
```

That hits `https://shelterlink.online` by default. Point it elsewhere with
`SMOKE_BASE_URL`:

```bash
SMOKE_BASE_URL=http://localhost:3000 npm run smoke
SMOKE_BASE_URL=https://your-preview.example npm run smoke
```

Exit code 0 means every check passed. Exit code 1 means at least one failed.
Fix the deploy before you treat the release as done.

## What it checks

| Path | Expect |
| --- | --- |
| `GET /healthz` | `200` with body `{ "db": true }` only |
| `GET /api/health` | `200` with `{ "status": "ok" }` |
| `GET /`, `/register`, `/login.html` | `200` HTML |
| `GET /pages/opportunities.html` | `200` HTML |
| `GET /pages/group-booking.html` | `200` HTML |
| `GET /pages/privacy.html` | `200` HTML |
| `GET /api` | `200` plain text (`ShelterLink API Running`) |
| `GET /api/public/config` | `200` JSON |
| `GET /api/public/brand` | `200` JSON |
| `GET /api/public/opportunities` | `200` JSON list |

Health responses must not include passwords, tokens, connection strings, or
other secrets. Uptime monitors should also use `GET /healthz` (see `DEPLOY.md`).

## Lifecycle smoke (local only)

The older end-to-end script still exists for a full volunteer lifecycle against
a local seeded database. It writes rows and refuses production:

```bash
npm run db:reset
npm run dev          # other terminal
npm run smoke:e2e    # needs SMOKE_ADMIN_PASSWORD
npm run db:clean-demo
```

Do not run `smoke:e2e` against shelterlink.online.

## When to run

- After every production deploy
- After applying migrations (coordinator/keeper applies those; this check
  confirms the app still boots and serves)
- Before calling a release "live" for Assisi or another shelter
