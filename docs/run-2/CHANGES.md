# Run 2 changes

Summary for Ryan is refreshed every fifth approved task.

- H1: Removed eleven identical duplicate files. Five older copies are in gitignored `_to_delete/`, with the differences in `docs/run-2/QUESTIONS.md`. Commit 2a14718. `npm test` passed (441). Those five copies are not deleted.
- A2: `setup-db` refuses a Supabase host unless `CONFIRM_LIVE_SHELTER=yes`, refuses demo seed unless the host is localhost or 127.0.0.1, and resolves the host the way pg does. `dev:local`, `db:local:reset` and `db:local:migrate` refuse any other host. Commits b9d795e, c760f01. `npm test` passed (452).
- L1: `ENV_FILE` loads one env file and does not also load `.env`. Local database is `shelterlink_dev` on 127.0.0.1. Commit 42d1f7a. `npm test` passed (447). Tenant isolation passed. Signed in as the seeded admin and as Alex Jenkins. This changes how every script loads config. Migration 034 stays skipped until `BACKUP_CONFIRMED=yes`.
