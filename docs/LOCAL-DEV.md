# Local development

Use this so a dev server talks to Postgres on this Mac. Do not use `npm run dev`. That loads `.env`, which points at the live database. Do not use `scripts/pg-connection.sh` for local work either. That script reads `.env` directly.

## One-time setup

PostgreSQL 16 is installed with Homebrew.

```
brew services start postgresql@16
createdb -h 127.0.0.1 shelterlink_dev
```

`database/033_add_shelters.pg.sql` grants a role to `postgres`. Homebrew's superuser is your Mac user, so create that role once on the local cluster:

```
psql -h 127.0.0.1 -d postgres -c "CREATE ROLE postgres LOGIN SUPERUSER"
```

Skip that statement if the role already exists.

`.env.local` is gitignored. It is `.env.example` with these differences:

- `NODE_ENV=development`
- `DATABASE_URL` is `postgresql://<mac-user>@127.0.0.1:5432/shelterlink_dev`
- `DB_HOST=127.0.0.1` and `DB_NAME=shelterlink_dev`
- `SESSION_SECRET` is a random local value
- email settings are blank
- demo hints are the seeded admin and Alex Jenkins

`ENV_FILE=.env.local` loads that file and does not load `.env`.

`dev:local`, `db:local:reset` and `db:local:migrate` refuse to start unless the host pg would use is `localhost` or `127.0.0.1`. The host is read the way pg reads it: the `host` query parameter, then `PGHOST` when the URL host is empty. A trailing dot is ignored. A URL that does not parse is refused.

## Each time you want a fresh local database

```
npm run db:local:reset
npm run db:local:migrate
npm run dev:local
```

Open http://localhost:3000/login.html

Seeded passwords are in the comment at the top of `database/seed.pg.sql`.

- Admin: `admin@shelterlink.org` / `Admin123!`
- Volunteer: `alex.jenkins@example.com` / `Password1`

The login page shows both while `NODE_ENV` is not production.

`db:local:migrate` skips `034_users_email_lower_unique.pg.sql` until `BACKUP_CONFIRMED=yes`. On this throwaway database that is a local choice, not a live backup.

## Checked on 2 Nov 2026

- `npm run db:local:reset` rebuilt `shelterlink_dev` on `127.0.0.1` and loaded the seed.
- `npm run db:local:migrate` applied the pending migrations and skipped 034.
- `npm run dev:local` connected to `shelterlink_dev` and served port 3000.
- Signed in as the seeded admin (Ciara). Today, Shifts, Day sheet, and Volunteers loaded. Volunteers listed Alex Jenkins and the other seeded people.
- Signed out, then signed in as Alex Jenkins. Home and Find a shift loaded. Find a shift showed 9 shifts.
- `node --test test/loadEnv.test.js` passed. With `ENV_FILE` set, `.env` was not loaded.
- `node --test test/tenantIsolation.test.js` passed: 144 requests, shelter A unchanged. That test uses its own temporary cluster on `127.0.0.1:54329`, not `shelterlink_dev`.

The admin Today page used to say "Could not load applications" because it requested `/applications?limit=5`. That query is not allowed, so the API returned 400. I1 drops the query. The page still shows only the first five.
