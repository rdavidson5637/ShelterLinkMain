# ShelterLink

ShelterLink is a volunteer rota for one shelter at a time. A volunteer can register, complete a profile, apply for a shift, foster an animal, message about a shift without seeing another volunteer's contact details, and log hours. Staff can print a day sheet, keep animal records, ask for urgent cover, and place a foster.

One Node process serves the HTML, CSS, and JavaScript, and the Express API. The database is Postgres, on this machine or on Supabase. Scheduled jobs run in that same process, so the process has to stay up.

The database seed is sample data for local development. It is not a record of a sanctuary using this app.

## What the code does

Volunteers

- Register, sign in, and reset a forgotten password when email is configured
- Complete a profile, including time away and whether a home can foster
- Browse open shifts and apply once a profile is approved
- See animals linked to a shift, and log a walk, a feed, or social time
- Use shift chat and announcements by name, without peer contact details
- Record hours, badges, and a printable certificate
- Work through a checklist: profile, waiver, references, and a background check

Staff

- Print a day sheet and use the kiosk for check-in
- Keep animal records on shifts
- Copy a shift, add a shift note, and flag urgent cover
- Place fosters
- Read message threads
- Track qualifications, waivers, references, and background checks
- Review group bookings, approve hours, and export or erase a volunteer record

The site can be installed from the browser. This file does not name a host.

## Stack

- Node.js 22 or newer, and Express
- Postgres through the `pg` package. Some queries still use `?` placeholders. `config/database.js` turns those into Postgres parameters. There is no MySQL database. `database/schema.sql` and `database/seed.sql` are older files kept beside the Postgres files.
- Sessions with `express-session` and `connect-pg-simple`
- Passwords with bcrypt
- `helmet`, `express-rate-limit`, and `validator` on requests
- Email with nodemailer when `EMAIL_*` is set. Blank email settings leave sending off.
- HTML, CSS, and JavaScript in `frontend/`, with no build step

Pico 2.1.1 and FullCalendar 6.1.19 are not in git. Installing dependencies runs `scripts/ensure-vendor.js`, which downloads them from jsDelivr when the files are missing. That step needs network access.

- Pico 2.1.1, MIT, `frontend/public/css/vendor/pico-2.1.1.min.css`
- FullCalendar 6.1.19, MIT, `frontend/public/js/vendor/fullcalendar-6.1.19.min.js`

## How a request is scoped

A signed-in request takes its shelter from the user row. The API rejects `shelter_id` in the body, the query, or the URL.

Shelter-owned tables have a `shelter_id`. Before those queries, the connection sets `app.shelter_id` and runs `SET LOCAL ROLE shelterlink_tenant`. The Postgres policy `tenant_isolation` applies to that role. The application role bypasses the policy unless that switch runs. `session`, `job_runs`, and `schema_migrations` are not tenant tables.

On this branch, a public page with nobody signed in stays on the sample shelter. A public address that names another shelter is on the unmerged branch `features/shelter-slug`.

One email can belong to one shelter. A person at two shelters is not built.

The longer note is `docs/tenancy/design.md`.

## Local setup

Install Node.js 22 or newer and the dependencies, then follow `docs/LOCAL-DEV.md`. That file is the local setup. This one does not copy it.

These scripts read `.env.local` and refuse a database host that is not this machine:

```bash
npm run db:local:reset
npm run db:local:migrate
npm run dev:local
```

`npm run dev`, `npm run db:setup`, `npm run db:reset`, `npm run db:clean-demo`, and `npm run migrate` read `.env`. Do not use them for local work.

Sample logins are described in `docs/LOCAL-DEV.md`. They are sample accounts.

`npm run db:local:migrate` skips migration 034 until `BACKUP_CONFIRMED=yes`.

## Tests

`npm test` runs Node's test runner over `test/*.test.js`. Most of those tests mock the database.

Three checks skip in that run. They write to the local database and remove those rows afterwards:

```bash
npm run test:local
```

`npm run test:local` reads `.env.local` and refuses a host that is not this machine.

The tenant isolation test starts its own temporary Postgres cluster. It does not use the local development database. It runs as part of `npm test`.

This file does not quote a coverage figure.

## Layout

```
config/        Pool, env loading, TLS
controllers/   Request handlers
middleware/    Auth, shelter binding, validation
models/        Queries
routes/        Express routes
utils/         Shelter context and shared helpers
database/      schema.pg.sql, migrations, seed.pg.sql
scripts/       Local setup and checks
test/          node --test
frontend/      Pages and scripts served by Express
server.js      Entry point
```

`DEPLOY.md` describes a hosted setup. Read the open items below before treating a host as finished. `docs/SECURITY.md` is the security note.

## Still open

Remote database TLS checks the server certificate only when `DB_SSL_CA` is set. Without it, the connection string is unchanged and the certificate is not checked. That path has not been tried against a hosted database in this work.

On 2 Nov 2026, `npm audit --omit=dev` still reported one high finding: `zod` 3.25.76. The offered upgrade is zod 4, a breaking change, and it was left. See `docs/run-2/QUESTIONS.md`.

Erasure, log out everywhere, and password reset delete sessions outside the tenant role in this code. Whether a hosted database still has the older grant is unchecked. Do not grant `session` to `shelterlink_tenant`. The check is in `docs/run-2/QUESTIONS.md`.

Hours dated before the shift are accepted. A volunteer who has already checked in can still ask someone else to cover the shift. A reference link that did not send cannot be sent again. Those three are open questions in the same file.

`session`, `job_runs`, and `schema_migrations` sit outside the tenant policy. Locking those down on a hosted project is still open.

## Security

Passwords are hashed with bcrypt. The session cookie is httpOnly. See `docs/SECURITY.md`. Do not commit `.env` or `.env.local`.

## Licence

MIT, as set in package.json.
