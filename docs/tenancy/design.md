# Shelter tenancy

This is the design that is already in the code. Do not add a second shelter model beside it.

The earlier plan is `database/033_add_shelters.pg.sql`, `utils/shelterContext.js`, `middleware/shelter.js`, `services/shelterProvision.js`, and `scripts/create-shelter.js`. `database/schema.pg.sql` does not contain the `shelters` table. A fresh setup applies `033` afterwards. That gap is real. It is not a reason to design a different system.

## What exists

`shelters` holds id, name, slug, logo, and logo mime type. Assisi is id 1, slug `assisi`.

Shelter-owned tables get `shelter_id`. The list the query switch knows about is `TENANT_TABLES` in `utils/shelterContext.js`. `session`, `job_runs`, and `schema_migrations` stay global.

`middleware/shelter.js` `bindShelter` loads the shelter from the logged-in user row. It does not take a shelter id from the body, query, or URL. A request that sends `shelter_id` is rejected.

Postgres row level security policy `tenant_isolation` applies to role `shelterlink_tenant`. The application role bypasses that policy unless the request runs `SET LOCAL ROLE shelterlink_tenant`. Whether every query path does that still needs a check on the live database. The isolation script covers the routes it lists, on a local database named `shelterlink_tenant_test` only.

## Users

Today one `users` row has one `role` and one `shelter_id`. A person cannot volunteer at two shelters without a second account.

Recommendation: keep one user row per person, and add a membership table later (`user_id`, `shelter_id`, `role`). Leave the current `users.role` and `users.shelter_id` in place until the code reads membership instead. That does not block two shelters later, and it does not force a second login system now.

Trade-off: until membership exists, a person who helps at two sanctuaries needs two accounts. Building membership now, before a second shelter is using the app, adds a migration and a role lookup on every request for no current user.

## Roles

Roles today are `volunteer`, `staff`, and `admin`, stored on the user and checked from the session after a database reload. They are not per shelter beyond the single `shelter_id` on the user.

A platform owner, separate from a shelter admin, is not in the schema. Recommendation: add it only when someone other than Assisi's admins needs to create shelters. That account should create shelters and read shelter name and slug. It should not read volunteer profiles, documents, or messages unless a shelter admin invites it. Needs a migration. Do not add it in the same change as query fixes.

## How a request learns its shelter

Options:

1. Subdomain (`assisi.shelterlink.online`). Clear for the public, and more DNS and certificate work.
2. Path (`/s/assisi`). Works on one host, and every link has to keep the prefix.
3. Login. The shelter comes from the user row. Public pages use the shelter the deployment is for, which today is Assisi.

Recommendation: keep login-based resolution. Public unauthenticated routes already resolve to Assisi when no session shelter is set. A subdomain can sit in front of that later without changing the tables.

## Enforcement

The single place is `utils/shelterContext.js` plus the Postgres policy. New queries on a shelter-owned table have to run inside `runWithShelter` or `bindShelter`, or they see every shelter.

MySQL views do not apply. This database is Postgres. Row level security is already the database-side control. It only helps when the connection uses `shelterlink_tenant`. The app role bypasses it. So the application switch and the role switch both have to run. A query that forgets both is the leak.

## Branding

`shelters` already has name, slug, and logo. Colours, contact email, privacy contact, and retention periods are not columns. Custom volunteer fields already exist as rows, not as per-shelter config beyond `shelter_id` on those rows. Add colours and contact email only when a second shelter needs them. Retention stays in the environment until Assisi sets numbers. Per-shelter retention needs a column and is a migration.

## Data protection

Each shelter should be its own controller once a second shelter is live. The privacy notice is written for Assisi and still has unconfirmed controller wording. Export and erase run as the signed-in admin and follow `bindShelter`, so they should only see that shelter's volunteers. A platform owner must not gain an export of every shelter by default.

## Existing Assisi data

`033` inserts Assisi as id 1 and backfills `shelter_id`. Rollback is the down path of that migration, after a backup. `scripts/backup-db.sh` or `npm run backup` has to run first, and not against a guess about which database is production. Do not run a second backfill.

## Leaks and the test that catches them

| Leak | Test |
|---|---|
| A request passes another shelter id in the body or query | `test/tenantIsolation.run.js` expects `shelter_id is not accepted` |
| A logged-in user reads another shelter's row by id | Same script, expect 403 or 404 |
| A query runs without a shelter on the connection | Review `runWithShelter` call sites. The isolation script does not prove every model method. |
| The app role bypasses row level security | Confirm `SET LOCAL ROLE shelterlink_tenant` on the live path. Not confirmed from this machine. |

## What prompts 15 to 18 should do

15. Do not create a second `shelters` table. If `033` is not on the live database, apply that file on a copy after a backup. Show the SQL and wait. No application rewrite in that step.

16. One module at a time, make sure each query runs inside the existing shelter switch. Do not add a second helper with a different name.

17. Resolve the shelter from the user row, which `bindShelter` already does. Branding reads `shelters.name` and the logo. Do not invent colours.

18. Extend `test/tenantIsolation.run.js` for any route that prompt 16 changes. Keep the localhost and `shelterlink_tenant_test` refusal.
