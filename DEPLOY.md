# ShelterLink deploy

Host-agnostic notes for running the Express app on Railway, Render, or similar,
with Supabase Postgres as the database.

Decisions already made in the app:

- Staff can set a background check's type, status, and dates. Only an admin
  sees or edits the reference number and notes. A volunteer sees their own
  reference number and not the notes.
- `APP_URL` must be `https://`. Password-reset links are not sent from an
  `http://` address.
- Scheduled jobs follow `SHELTER_TIMEZONE`. A blank value in production means
  Europe/London.
- Demo accounts are never returned when `NODE_ENV` is `production`.
- Retention periods and the Article 10 paperwork stay with Assisi. The app
  does not invent them. Do not type offence detail into check notes.

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
production if `SESSION_SECRET`, `ADMIN_REGISTRATION_KEY`, `APP_URL`, or `DATABASE_URL` is missing,
weak (`change_me`, `replace_me`, `shelterlink-admin`, `demo`, localhost APP_URL),
or too short, so a misconfigured deploy fails loudly at boot instead of running
insecurely.

`POST /api/auth/register-admin` is always 404 in production. Create the first
admin with `npm run create-admin`. That command attaches the admin to the only
shelter in the database. If there is more than one, pass `--shelter` and its slug.
A user with no shelter cannot sign in. On Supabase, set `CONFIRM_LIVE_SHELTER=yes`.
Put the password in `ADMIN_INITIAL_PASSWORD` so it is not left in shell history.
Password reset tokens are stored hashed. Reset emails need working `EMAIL_*`
SMTP or the token is rolled back. Expired reset tokens are cleared by an hourly job.


| Variable | Notes |
|---|---|
| `DATABASE_URL` | Session pooler URI, port 5432 |
| `SESSION_SECRET` | Fresh long random string |
| `ADMIN_REGISTRATION_KEY` | Fresh secret, share only with shelter staff who create admins |
| `FEEDBACK_TOKEN_SECRET` | Optional; falls back to `SESSION_SECRET` |
| `APP_URL` | Public HTTPS origin, e.g. `https://shelterlink.online`. `http://` is refused. Also an origin allowed to make credentialed cross-origin API calls |
| `CORS_ORIGINS` | Optional, comma separated. Only needed if something outside this app calls the API |
| `NODE_ENV` | `production` |
| `PORT` | Provided by the host |
| `SHELTER_TIMEZONE` | IANA zone the shelter is in, e.g. `Europe/London`. Day sheets and scheduled jobs use this zone. If it is blank in production, jobs use Europe/London |
| `TZ` | Set the same zone on the host. The scheduler no longer depends on it, but other logs do |
| `WEB_PUSH_VAPID_PUBLIC_KEY` `WEB_PUSH_VAPID_PRIVATE_KEY` `WEB_PUSH_VAPID_SUBJECT` | Generate once with `npx web-push generate-vapid-keys`. Do not rotate after launch |
| `EMAIL_HOST` `EMAIL_PORT` `EMAIL_USER` `EMAIL_PASS` `EMAIL_FROM` | Brevo SMTP (or equivalent) |
| `DATA_RETENTION_YEARS` | Leave blank until Assisi sets a period. A number anonymises inactive volunteer accounts. There is no default |
| `DB_CONNECTION_LIMIT` | `10` (Supabase free-tier budget) |

The app writes no user files to disk, so no persistent volume is required.
Uploaded volunteer documents (AccessNI, references) and animal photos are
stored as `bytea` in Postgres, so they survive redeploys on hosts with an
ephemeral filesystem and are captured by `npm run backup` (`pg_dump`).

Create the first real admin after deploy (`POST /api/auth/register-admin` stays 404 in production):

```bash
CONFIRM_LIVE_SHELTER=yes ADMIN_INITIAL_PASSWORD='a-long-password' npm run create-admin -- "Name" admin@your-shelter.org
```

## 4. Health checks and backups

- Point UptimeRobot (or the host health check) at `GET /healthz`.
  It returns `200 { "db": true }` or `503 { "db": false }`.
- Cron on the host: `npm run backup` daily. The script refuses to run without
  `BACKUP_ENCRYPTION_KEY` (at least 16 characters) and writes
  `backups/shelterlink-YYYY-MM-DD.sql.gz.enc`. It does not leave a plaintext
  dump. Files in that folder older than 14 days are pruned. Copy each file
  off the server. `pg_dump` must be available. The Dockerfile installs
  `postgresql-client`.
- Before an existing database gets `034_users_email_lower_unique.pg.sql`,
  take that backup and run `BACKUP_CONFIRMED=yes npm run migrate`. A fresh
  `node scripts/setup-db.js --no-seed` already includes the index and then
  applies shelter tenancy. Do not run `db:reset` on a database that has real
  volunteers.
- Check the machine before you deploy: `npm run check-prod`. It prints the
  names of missing settings. It does not print secret values and it does not
  connect to the database.

## Production checklist

- [ ] Fresh `SESSION_SECRET`, `ADMIN_REGISTRATION_KEY`, `FEEDBACK_TOKEN_SECRET`
- [ ] HTTPS provided by the host
- [ ] `EMAIL_*` filled with Brevo (or other) SMTP
- [ ] `DATA_RETENTION_YEARS` left blank until Assisi sets the period
- [ ] Schema applied with `--no-seed` (no `admin@shelterlink.org` demo user)
- [ ] First real admin created via `npm run create-admin`
- [ ] `/healthz` monitored
- [ ] Backup cron in place and one restore tested
