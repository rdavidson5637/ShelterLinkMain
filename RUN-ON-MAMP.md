# Run ShelterLink on MAMP

Everything is pre-configured. `.env` is filled in with MAMP defaults (localhost:8889, root/root) and generated secrets. Email sending is off, so reset links and notifications print to the server console instead.

## First run

1. Start MAMP (MySQL must be running on port 8889).
2. In this folder:

```bash
npm install
npm run db:reset      # builds all tables (schema includes migrations 001-017) + sample data
npm run dev
```

3. Open http://localhost:3000

Logins from the seed data:

| Role      | Email                      | Password  |
|-----------|----------------------------|-----------|
| Admin     | admin@shelterlink.org      | Admin123! |
| Volunteer | alex.jenkins@example.com   | Password1 |

## Smoke test

With the server running, in a second terminal:

```bash
npm run smoke
```

It registers a volunteer, creates and staffs a shift, logs and approves hours, checks badges, and exports a CSV, reporting pass/fail per step. Each run adds one volunteer and one opportunity; run `npm run db:reset` again to start clean.

## Unit tests (no DB needed)

```bash
npm test              # 129 tests, all passing as of the last verification
```

## If you already have real data

Do NOT run `db:reset` (it wipes everything). Instead:

```bash
npm run migrate            # applies any pending numbered migrations, tracked in schema_migrations
npm run migrate -- --dry-run   # preview only
```

## Quick manual pass (10 minutes)

As admin: create a weekly recurring opportunity with an until date, check child shifts appear. Note the check-in code on the opportunity. Open Messages, Qualifications, Custom fields, Waivers, Feedback, Groups, Audit, Privacy pages and confirm they load.

As volunteer: complete profile, get it approved by admin, apply to a shift, fill a shift and join the waitlist on another account, log hours, check badges on the dashboard.

Kiosk: open http://localhost:3000/kiosk, unlock as admin, confirm today's shifts show. Then confirm the kiosk session cannot open /pages/admin/dashboard.html data (API calls should 403).

Staff role: create a second account, set its role to 'staff' in the DB or via admin, confirm it can manage opportunities but not approve profiles or export.

## Creating your own admin

`ADMIN_REGISTRATION_KEY` is already set in `.env`:

```bash
npm run create-admin
```

## Known limits of this setup

Scheduler jobs (reminders, expiry warnings, feedback requests, retention) run in-process while `npm run dev` is up; nothing runs when the server is stopped. Email is console-only until you fill EMAIL_* in `.env`.
