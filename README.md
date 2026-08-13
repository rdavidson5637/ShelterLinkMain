# ShelterLink

ShelterLink is a volunteer management system for an animal shelter. Volunteers
register, complete a profile, browse and apply for shifts ("opportunities"),
and log their service hours. Administrators review volunteers and applications,
create and manage opportunities, approve logged hours, and export reports.

It is a full-stack application: a Node.js/Express REST API backed by MySQL, with
a static HTML/CSS/JavaScript frontend served by the same server.

## Features

**Volunteers**
- Register, log in, and reset a forgotten password (email link)
- Complete a volunteer profile (contact, emergency contact, skills, availability)
- Browse open opportunities and apply (once the profile is approved)
- View and cancel their own applications
- Log volunteer hours and track approval status
- Earn achievement badges based on approved hours and completed shifts

**Administrators**
- Review and approve volunteer profiles
- Create, edit, and close opportunities, with capacity limits
- Review applications and accept or reject them (opportunities auto-close when full)
- Approve logged volunteer hours
- Dashboard statistics and CSV export of reports

## Tech stack

- **Express.js** — web framework and REST API
- **MySQL** (via `mysql2`) — data store
- **express-session** + `express-mysql-session` — server-side sessions
- **bcrypt** — password hashing
- **helmet**, **express-rate-limit**, **xss**, **validator** — security hardening
- **nodemailer** — transactional email (password reset, application updates)
- Vanilla HTML/CSS/JS frontend (no build step)

## Getting started

### Prerequisites
- Node.js 18+
- A running MySQL server. MAMP is the assumed default (host `localhost`,
  port `8889`, user `root`, password `root`). Standard MySQL uses port `3306`.

### 1. Install dependencies
```bash
npm install
```

### 2. Configure environment
```bash
cp .env.example .env
```
Then edit `.env` and set at least:
- `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME` — your MySQL connection
- `SESSION_SECRET` — a long random string
- `ADMIN_REGISTRATION_KEY` — required to create admin accounts
- Email (`EMAIL_*`) values if you want password-reset / notification emails to send

### 3. Create the database
With MySQL running, build the schema and load sample data in one step:
```bash
npm run db:reset      # schema + sample data (recommended for a first run)
```
or, for an empty database with no sample data:
```bash
npm run db:setup      # schema only
```
This uses the connection settings from your `.env`. You can also run the SQL
files directly if you prefer:
```bash
mysql -u root -proot -h 127.0.0.1 -P 8889 < database/schema.sql
mysql -u root -proot -h 127.0.0.1 -P 8889 ShelterLink < database/seed.sql
```

### 4. Run the app
```bash
npm run dev           # development, auto-restart on changes
# or
npm start             # production-style start
```
Then open **http://localhost:3000**.

## Sample login accounts

Loaded by `npm run db:reset` (via `database/seed.sql`):

| Role      | Email                       | Password    |
|-----------|-----------------------------|-------------|
| Admin     | `admin@shelterlink.org`     | `Admin123!` |
| Volunteer | `alex.jenkins@example.com`  | `Password1` |

All seeded volunteer accounts use the password `Password1`. See `database/seed.sql`
for the full list. **Change or remove these before any real deployment.**

To create your own admin account instead, set `ADMIN_REGISTRATION_KEY` in `.env`
and run:
```bash
npm run create-admin
```

## Testing

The project ships with an automated test suite built on Node's built-in test
runner (no extra dependencies). The tests mock the database layer, so they run
without a live MySQL connection and verify query construction, business logic
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

## Project structure
```
config/        Database pool and connection helpers
controllers/   Request handlers (auth, opportunities, applications, hours, stats, export)
middleware/    Auth guards, input sanitisation, rate limiting, error handling
models/        Data-access helpers, one per table (+ code-defined Badge)
routes/        Express route definitions
utils/         Email service and CSV export helpers
database/      schema.sql (full schema), seed.sql (sample data), migrations
scripts/       setup-db.js (build/seed the database from .env)
test/          Automated tests (node --test) with a mocked DB pool
frontend/      Static site: pages/, js/, public/ (css, images), served by Express
docs/          SECURITY.md and other documentation
server.js      App entry point
```

## Database

`database/schema.sql` is the authoritative, from-scratch schema. It creates six
tables: `users`, `opportunities`, `volunteer_profiles`, `applications`,
`volunteer_hours`, and `sessions` (session store). Badges are defined in code
(`models/Badge.js`), not in the database.

Incremental changes live in `database/` as numbered migrations
(e.g. `001_add_password_reset.sql`) and are already folded into `schema.sql`.

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
