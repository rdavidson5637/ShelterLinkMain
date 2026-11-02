# Run 2 changes

Local database guards and the env loader are in. Today loads applications. A failed day or week sheet clears the old table. Closing a shift uses the shared dialog. The check-in page is written by the opener. CSV export no longer uses json2csv. The image sets production before install. Email fields no longer auto-capitalise. Foster names and notes are escaped. Database TLS verifies a certificate only when a CA is set. Each tenant test has its own cluster. The kiosk uses the shelter's day. The tenant table list is checked against the migration. Five older duplicate files are still in `_to_delete/` for you to delete or keep.

- H1: Removed eleven identical duplicate files. Five older copies are in gitignored `_to_delete/`, with the differences in `docs/run-2/QUESTIONS.md`. Commit 2a14718. `npm test` passed (441). Those five copies are not deleted.
- A2: `setup-db` refuses a Supabase host unless `CONFIRM_LIVE_SHELTER=yes`, refuses demo seed unless the host is localhost or 127.0.0.1, and resolves the host the way pg does. `dev:local`, `db:local:reset` and `db:local:migrate` refuse any other host. Commits b9d795e, c760f01. `npm test` passed (452).
- L1: `ENV_FILE` loads one env file and does not also load `.env`. Local database is `shelterlink_dev` on 127.0.0.1. Commit 42d1f7a. `npm test` passed (447). Tenant isolation passed. Signed in as the seeded admin and as Alex Jenkins. This changes how every script loads config. Migration 034 stays skipped until `BACKUP_CONFIRMED=yes`.
- sheet-catch: A failed day or week sheet load now clears the old table as well as showing the error. Commit 348dac2. `npm test` passed (452).
- I1: Today asks for `/applications` without `?limit=5`, so recent applications load. The certificate empty state uses the same words as the button. Commit 860da31. `npm test` passed (452). Checked on the local admin page: five applications listed, and the page did not say it could not load them.
- pg-conn: `pg-connection-string` is a direct dependency. `docs/LOCAL-DEV.md` says `scripts/pg-connection.sh` reads `.env` directly. Commit 36e8b6e.
- F1: Closing a shift uses the shared dialog. A series offers Just this shift, This and the whole series, and Keep it. A single shift offers Close this shift and Keep it. Keep sends no request. The series choice still deletes with `?series=true`. Commit eb8b598. `npm test` passed (454).
- F2: The check-in page is written by the opener and has no script. The shift title is escaped. Commit 9ee36f9. `npm test` passed (454).
- A3: CSV export is a small writer. json2csv is gone. body-parser and multer were updated without a force upgrade. zod 3 stays, and the zod 4 question is in QUESTIONS.md. Commit 3d60e16. `npm test` passed (456).
- A5: The image sets NODE_ENV=production before npm ci. Commit c9edde1. This changes the deploy image.
- B1: Email fields set autocapitalize none, autocorrect off, spellcheck false, and inputmode email. Commit a2c483f. Checked the local login page and the other HTML pages that have an email field.
- B3: Foster request and placement names, notes and dates are escaped on the staff page. Commit ee4a732. `npm test` passed (456). A description of `<b>bold</b>` showed as text, then that request was cancelled.
- A3b: Dates become ISO strings. Objects and arrays become JSON. The formula prefix then applies to that text, so an array does not slip through as `=1`. Commit 699e7a1. `node --test test/csvExport.test.js` passed (5).
- B5: Remote database TLS verifies the certificate when `DB_SSL_CA` is set, including a bundle. A value that is not a certificate stops startup. Without a CA, the connection string is unchanged and the certificate is not checked. Commits 1c40c74, 94a4458, 5d1deb9. `npm test` passed (462, with the local audit check skipped). This touches the database connection.
- I2: Each tenant test uses its own data directory and a free port, and deletes only that directory. Commit 326d256. Two overlapping runs both passed.
- B8: Kiosk today and check-in use the shelter's day. At 23:30 UTC on 29 March 2026 the day is 30 March. Commit df0573a. `node --test test/kioskTime.test.js` passed.
- T1: `TENANT_TABLES` matches the table array in migration 033, plus `shelters`. Commit 59cbcc7. No database. The test passed.
- B6: Staff profile views and admin document downloads are written to the audit log after the response. A volunteer downloading their own file is not logged. The local check skips unless `LOCAL_DB_REQUIRED=1` and refuses any host that is not local before it connects. Commit c427974. `npm test` passed (462, that check skipped). This touches audit logging.

### A3 audit, 2 Nov 2026

`npm audit --omit=dev` before the fix: body-parser below 1.20.9 (high), multer 2.0.0 to 2.4.0 (high), zod below 4.6.6 (high, needs `--force`).

After `npm audit fix` with no `--force`, and after removing `json2csv`: body-parser and multer are gone. multer is locked at 2.5.0. zod 3.25.76 remains. The offered fix is zod 4.6.7, a breaking change, so it is in QUESTIONS.md. A second `npm audit --omit=dev` reports that one high vulnerability.
