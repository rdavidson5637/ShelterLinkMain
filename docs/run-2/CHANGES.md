# Run 2 changes

Local database guards and the env loader are in. Today loads applications. A failed day or week sheet clears the old table. Five older duplicate files are still in `_to_delete/` for you to delete or keep.

- H1: Removed eleven identical duplicate files. Five older copies are in gitignored `_to_delete/`, with the differences in `docs/run-2/QUESTIONS.md`. Commit 2a14718. `npm test` passed (441). Those five copies are not deleted.
- A2: `setup-db` refuses a Supabase host unless `CONFIRM_LIVE_SHELTER=yes`, refuses demo seed unless the host is localhost or 127.0.0.1, and resolves the host the way pg does. `dev:local`, `db:local:reset` and `db:local:migrate` refuse any other host. Commits b9d795e, c760f01. `npm test` passed (452).
- L1: `ENV_FILE` loads one env file and does not also load `.env`. Local database is `shelterlink_dev` on 127.0.0.1. Commit 42d1f7a. `npm test` passed (447). Tenant isolation passed. Signed in as the seeded admin and as Alex Jenkins. This changes how every script loads config. Migration 034 stays skipped until `BACKUP_CONFIRMED=yes`.
- sheet-catch: A failed day or week sheet load now clears the old table as well as showing the error. Commit 348dac2. `npm test` passed (452).
- I1: Today asks for `/applications` without `?limit=5`, so recent applications load. The certificate empty state uses the same words as the button. Commit 860da31. `npm test` passed (452). Checked on the local admin page: five applications listed, and the page did not say it could not load them.
- pg-conn: `pg-connection-string` is a direct dependency. `docs/LOCAL-DEV.md` says `scripts/pg-connection.sh` reads `.env` directly. Commit 36e8b6e.

### A3 audit, 2 Nov 2026

`npm audit --omit=dev` before the fix: body-parser below 1.20.9 (high), multer 2.0.0 to 2.4.0 (high), zod below 4.6.6 (high, needs `--force`).

After `npm audit fix` with no `--force`, and after removing `json2csv`: body-parser and multer are gone. multer is locked at 2.5.0. zod 3.25.76 remains. The offered fix is zod 4.6.7, a breaking change, so it is in QUESTIONS.md. A second `npm audit --omit=dev` reports that one high vulnerability.
