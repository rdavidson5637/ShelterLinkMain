# ShelterLink deploy

Host-agnostic notes for running the Express app on Railway, Render, or similar,
with Supabase Postgres as the database.

The app host must be **always-on**. The in-process scheduler (shift reminders,
keep-alive ping, backups if you cron them on the same box) does not run if the
process sleeps. Supabase's free tier pauses after about a week of inactivity;
the daily `dbKeepAlive` job only helps if this app is actually running.

## 1. Create the Supabase project

1. Create a free project at [supabase.com](https://supabase.com).
2. Copy the **Session pooler** URI (port **5432**). Do not use the transaction
   pooler on port 6543 — it breaks `connect-pg-simple` and prepared statements.
3. Store the database password somewhere safe.

## 2. Build the schema

From a machine that can reach Supabase:

```bash
export DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres'
node scripts/setup-db.js --no-seed
```

`--no-seed` so demo accounts are not created in production. If `NODE_ENV` is
already `production` in your shell, `setup-db.js` refuses to run (it DROPs every
table) — add `--force` for this **first** build only. Never run it against a
populated production database; use `npm run migrate` to apply new migrations
without data loss.

## 3. Deploy the app

Set these environment variables on the host. The app **refuses to start** in
production if `SESSION_SECRET`, `ADMIN_REGISTRATION_KEY` or `APP_URL` is missing
or still set to a `change_me...` placeholder, so a misconfigured deploy fails
loudly at boot instead of running insecurely.


| Variable | Notes |
|---|---|
| `DATABASE_URL` | Session pooler URI, port 5432 |
| `SESSION_SECRET` | Fresh long random string |
| `ADMIN_REGISTRATION_KEY` | Fresh secret, share only with shelter staff who create admins |
| `FEEDBACK_TOKEN_SECRET` | Optional; falls back to `SESSION_SECRET` |
| `APP_URL` | Public HTTPS origin, e.g. `https://your-app.up.railway.app`. Also the only origin allowed to make credentialed cross-origin API calls |
| `CORS_ORIGINS` | Optional, comma separated. Only needed if something outside this app calls the API |
| `NODE_ENV` | `production` |
| `PORT` | Provided by the host |
| `SHELTER_TIMEZONE` | IANA zone the shelter is physically in, e.g. `Europe/London`. The host almost never runs in this zone (most default to UTC) — this is what the day sheet/week sheet use to work out "today", not the server clock |
| `EMAIL_HOST` `EMAIL_PORT` `EMAIL_USER` `EMAIL_PASS` `EMAIL_FROM` | Brevo SMTP (or equivalent) |
| `DATA_RETENTION_YEARS` | Confirm (default 3) |
| `DB_CONNECTION_LIMIT` | `10` (Supabase free-tier budget) |

The app writes no user files to disk, so no persistent volume is required.
Uploaded volunteer documents (AccessNI, references) and animal photos are
stored as `bytea` in Postgres, so they survive redeploys on hosts with an
ephemeral filesystem and are captured by `npm run backup` (`pg_dump`).

Create the first real admin after deploy:

```bash
npm run create-admin -- "Name" admin@your-shelter.org 'a-strong-password'
```

## 4. Health checks and backups

- Point UptimeRobot (or the host health check) at `GET /healthz`.
  It returns `200 { "db": true }` or `503 { "db": false }`.
- Cron on the host: `npm run backup` daily. Dumps land in `backups/` as
  `shelterlink-YYYY-MM-DD.sql.gz` and files older than 14 days are pruned.
  `pg_dump` must be available on the host. The app Dockerfile installs
  `postgresql-client` so `npm run backup` works inside the container.

## Production checklist

- [ ] Fresh `SESSION_SECRET`, `ADMIN_REGISTRATION_KEY`, `FEEDBACK_TOKEN_SECRET`
- [ ] HTTPS provided by the host
- [ ] `EMAIL_*` filled with Brevo (or other) SMTP
- [ ] `DATA_RETENTION_YEARS` confirmed
- [ ] Schema applied with `--no-seed` (no `admin@shelterlink.org` demo user)
- [ ] First real admin created via `npm run create-admin`
- [ ] `/healthz` monitored
- [ ] Backup cron in place and one restore tested
