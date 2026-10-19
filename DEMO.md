# ShelterLink demo instance

A throwaway copy of ShelterLink for showing other rescues. It uses fictional
people and animals, resets every night, and must never share a database with a
real deployment.

## Set up

1. Create a separate Postgres database (not the production one).
2. Set these on the demo host:
   - `DEMO_MODE=true`
   - `NODE_ENV=production`
   - `DATABASE_URL` for the demo database only
   - `APP_URL` for the demo domain, for example `https://demo.shelterlink.online`
   - new `SESSION_SECRET` and `ADMIN_REGISTRATION_KEY` values (never reuse production's)
   - the `SHELTER_*` branding variables for the rescue you are pitching (see `DEPLOY.md`)
   - leave `EMAIL_*` blank, or use a sandbox sender
3. Build it once: `npm run db:demo`.

`db:demo` exits without touching anything unless `DEMO_MODE=true`, and refuses
to drop a database that has any account outside `@example.com` or
`@shelterlink.org`. The same check runs before every nightly reset.

## What it does

- Every page shows a "Demo: data resets nightly" banner.
- The login page shows the demo accounts, even in production mode.
- A job rebuilds the schema and sample data in the 03:xx hour, shelter time
  (`SHELTER_TIMEZONE`, default Europe/London). It is only registered when
  `DEMO_MODE=true`.

## Demo accounts

| Role | Email | Password |
| --- | --- | --- |
| Admin | `admin@shelterlink.org` | `Admin123!` |
| Volunteer | `alex.jenkins@example.com` | `Password1` |

Other seeded volunteers use the same volunteer password.

## Walkthrough

1. Public page: browse open shifts without an account.
2. Log in as the volunteer: apply for a shift, check "My hours", look at the dashboard.
3. Log in as the admin: approve an application, open the day sheet, look at animals, transport and group bookings.
4. Install it on a phone from the browser menu to show the app experience.

The seed data is in `database/seed.pg.sql`. See `ASSISI-DEMO.md` for the
original Assisi-specific walkthrough.
