# ShelterLink

ShelterLink is a volunteer management system built for animal shelters (Assisi
first). Volunteers register, complete a profile, browse and apply for shifts,
foster animals, message about shifts without sharing personal contacts, and log
hours. Staff run the day from a printable day sheet, animals records, urgent
cover, and foster placements.

It is a full-stack application: a Node.js/Express REST API backed by Postgres
(Supabase or local), with a static HTML/CSS/JavaScript frontend served by the
same server. The app host must be always-on so scheduled jobs (reminders,
digests, keep-alive ping) can run.

See `DEPLOY.md` for production setup and `ASSISI-DEMO.md` for the shelter demo script.

## Features

**Volunteers**
- Register, log in, and reset a forgotten password (email link)
- Complete a profile (including foster home suitability and away mode)
- Browse open shifts (urgent cover highlighted); apply once approved
- See animals on a shift with handling notes; log walk / feed / socialise
- Shift chat and announcements (names only — no peer contact details)
- Foster matching, placements, and check-ins
- Hours logging, badges, printable service certificate
- Onboarding checklist (profile, waiver, references, AccessNI)
- Installable PWA on phones

**Administrators / staff**
- Morning staff guide, printable day sheet, kiosk check-in
- Animals as first-class records linked to shifts
- Opportunities: templates, clone, shift notes, urgent cover (email + optional push)
- Fosters: requests, offers, placements
- Threaded messaging with oversight
- AccessNI tracking and reference collection
- Qualifications, waivers, group bookings, hours approval, GDPR tools

## Tech stack

- **Express.js** — web framework and REST API
- **Postgres** (via `pg`, mysql2-compatible adapter in `config/database.js`)
- **express-session** + `connect-pg-simple` — server-side sessions
- **bcrypt** — password hashing
- **helmet**, **express-rate-limit**, **xss**, **validator** — security hardening
- **nodemailer** — transactional email (password reset, application updates)
- Vanilla HTML/CSS/JS frontend (no build step)

## Getting started

### Prerequisites
- Node.js 18+
- A Postgres database. Local (`brew install postgresql@16`) or a free
  [Supabase](https://supabase.com) project. Use the **session pooler** URI
  (port 5432), not the transaction pooler (6543).

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Then edit `.env` and set at least:
- `DATABASE_URL` — Supabase session pooler URI, **or** `DB_HOST` / `DB_PORT` /
  `DB_USER` / `DB_PASSWORD` / `DB_NAME` for local Postgres
- `SESSION_SECRET` — a long random string
- `ADMIN_REGISTRATION_KEY` — required to create admin accounts
- Email (`EMAIL_*`) values if you want password-reset / notification emails to send

### 3. Create the database
With Postgres reachable, build the schema and load sample data in one step:
```bash
npm run db:reset      # schema + sample data (recommended for a first run)
```
or, for an empty database with no sample data:
```bash
npm run db:setup      # schema only
```
This uses `DATABASE_URL` or `DB_*` from your `.env`. MySQL files
(`database/schema.sql`, `database/seed.sql`) are kept for reference only.

### 4. Run the app
```bash
npm run dev           # development, auto-restart on changes
# or
npm start             # production-style start
```
Then open **http://localhost:3000**.

## Sample login accounts

Loaded by `npm run db:reset` (via `database/seed.pg.sql`):

| Role      | Email                       | Password    |
|-----------|-----------------------------|-------------|
| Admin     | `admin@shelterlink.org`     | `Admin123!` |
| Volunteer | `alex.jenkins@example.com`  | `Password1` |

All seeded volunteer accounts use the password `Password1`. See `database/seed.pg.sql`
for the full list. **Change or remove these before any real deployment.**

To create your own admin account instead, set `ADMIN_REGISTRATION_KEY` in `.env`
and run:
```bash
npm run create-admin
```

## Testing

The project ships with an automated test suite built on Node's built-in test
runner (no extra dependencies). The tests mock the database layer, so they run
without a live database connection and verify query construction, business logic
(badge calculation, application/cancel guards, field whitelisting, hours
validation, CSV export) and controller rules (capacity limits, profile-approval
gating, open-only applications, accepted/approved hour logging):
```bash
npm test
```
Test files live in `test/`; `test/helpers/mockDb.js` installs an in-memory mock
in place of the real connection pool.

### End-to-end smoke test
For a full-stack confidence check against a **running** server (real DB, auth,
sessions and business rules), use the smoke test. It registers a volunteer,
creates and staffs a shift, logs and approves hours, checks badges, and exports
a CSV — reporting pass/fail per step:
```bash
npm run db:reset     # seed data (provides the admin account it signs in as)
npm run dev          # in one terminal
npm run smoke        # in another terminal
```
Each run adds one volunteer and one opportunity to the database.
Remove those rows without wiping the demo seed: `npm run db:clean-demo`.

## Project structure
```
config/        Database pool and connection helpers
controllers/   Request handlers (auth, opportunities, applications, hours, stats, export)
middleware/    Auth guards, input sanitisation, rate limiting, error handling
models/        Data-access helpers, one per table (+ code-defined Badge)
routes/        Express route definitions
utils/         Email service and CSV export helpers
database/      schema.pg.sql (Postgres), seed.pg.sql, plus MySQL originals for reference
scripts/       setup-db.js (build/seed the database from .env)
test/          Automated tests (node --test) with a mocked DB pool
frontend/      Static site: pages/, js/, public/ (css, images), served by Express
docs/          SECURITY.md and other documentation
server.js      App entry point
```

## Database

`database/schema.pg.sql` is the authoritative, from-scratch Postgres schema.
MySQL originals remain in `database/schema.sql` and numbered `NNN_*.sql`
files for reference. Future incremental changes use `NNN_*.pg.sql` and
`npm run migrate`.

The app host must stay running: a daily keep-alive job (`dbKeepAlive`) pings
the database so a free-tier Supabase project is less likely to pause. Backups:
`npm run backup` (requires `pg_dump`; dumps are gitignored under `backups/`).

## Environment variables

See `.env.example` for the full, commented list. Email is optional — leave the
`EMAIL_*` values blank to disable sending (password-reset links are still logged
server-side for local testing).

## Security

Passwords are hashed with bcrypt; sessions are httpOnly cookies; input is
sanitised and rate-limited; security headers are set via helmet. See
`docs/SECURITY.md` for details. Do not commit your real `.env`.

## License

MIT
