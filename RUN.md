# Run ShelterLink locally (Postgres)

Email is off by default, so reset links and notifications print to the server
console. You need either a local Postgres or a free Supabase project.

## First run

1. Create a database:
   - **Supabase:** project → Connect → **Session pooler** URI (port **5432**, not 6543).
   - **Local:** `brew install postgresql@16 && brew services start postgresql@16`, then create a `shelterlink` database.
2. Copy env and set the connection:

```bash
cp .env.example .env
# Set DATABASE_URL=postgresql://...:5432/postgres
# Or leave DATABASE_URL blank and fill DB_HOST / DB_PORT / DB_USER / DB_PASSWORD / DB_NAME
```

3. In this folder:

```bash
npm install
npm run db:reset      # builds schema.pg.sql + sample data
npm run dev
```

4. Open http://localhost:3000

| Role      | Email                      | Password  |
|-----------|----------------------------|-----------|
| Admin     | admin@shelterlink.org      | Admin123! |
| Volunteer | alex.jenkins@example.com   | Password1 |

## Smoke test

With the server running:

```bash
npm run smoke
```

Clean smoke rows without wiping the demo: `npm run db:clean-demo`.

## Unit tests (no DB needed)

```bash
npm test
```

## If you already have real data

Do **not** run `db:reset` (it wipes everything). Instead:

```bash
npm run migrate              # applies pending NNN_*.pg.sql files
npm run migrate -- --dry-run
```

## Quick manual pass

As admin: create a weekly recurring opportunity, note the check-in code, open
Animals / Messages / Qualifications / Waivers / Feedback / Groups / Audit /
Privacy and confirm they load.

As volunteer: complete profile (get approved), apply, waitlist a full shift,
log hours, check badges.

Kiosk: http://localhost:3000/kiosk — unlock as admin, confirm today's shifts,
confirm kiosk sessions cannot hit admin APIs (403).

## Creating your own admin

```bash
npm run create-admin -- "Name" you@example.com 'a-strong-password'
```

## Deploy

See `DEPLOY.md`. The app host must be always-on for the scheduler and the
Supabase keep-alive ping.
