# Reviews

Claude Code adds one line per reviewed task: id, verdict, findings.

## Redesign queue left review_ready in Concord (2 Nov 2026)

These tasks still say review_ready because their owner sessions have ended and Concord refuses a close from
another agent. All commits named are on `build/run-2`. For the tasks marked "earlier approval" I confirmed the
approval on record and the commits, and did not re-review them line by line. Their earlier reviews were not
signed in, because no local database existed then.

- C1 Design foundation: approved. Earlier specificity finding on `.danger` was fixed in C4.
- C2 App shell: earlier approval stands (a3cd7c7).
- C3 Public and auth pages: earlier approval stands (a3cd7c7).
- C4 Volunteer pages: earlier approval stands.
- C5 Consistency sweep: earlier approval stands. Lighthouse not rerun.
- C6 Foster, transport, messages: earlier approval stands.
- K6 Admin shifts, animals, comms: earlier approval stands (5fcf55a).
- P1 Skeletons and empty states: earlier approval stands.
- P2 Pico usage: earlier approval stands. Coverage not rerun.
- P3 Accessibility pass: earlier approval stands. axe not rerun.
- page-titles: approved (95a72f2). Reviewed in full. The 403 and 500 titles differ a little from their h1s, not blocking.
- sheet-skeletons: sent back (2cb3965), then fixed in sheet-catch (348dac2) below. Skeleton rows stayed under the error after a network failure.

## Run 2

- H1 Duplicate files: approved (2a14718). The eleven removed files cannot be re-compared now they are gone, so that part rests on Cursor's recorded `cmp` run.
- A2 Guard setup-db: approved (c760f01), after being sent back at b9d795e because `?host=`, `PGHOST`, a trailing dot and unparseable values got past the guard. Checked against `pg`'s own host resolution and with the real npm scripts on a `.invalid` host. To do: add `pg-connection-string` to `dependencies`.
- L1 Local Postgres: approved (42d1f7a, c760f01). 452 tests pass on an export with no `.env`. Signed-in sweep of 36 pages at 375 and 1280 clean apart from the two items now in I1. `scripts/pg-connection.sh` still reads `.env` directly for the backup shell scripts.
- I1 Today applications: approved (860da31). Dropped the `?limit=5` the API rejected with a 400; the same bug is on `main`, live site not checked. Newest five shown signed in at 375 and 1280. Certificate copy fixed. `/applications` has no server-side limit, so Today downloads them all.
- sheet-catch: approved (348dac2). Closes the sheet-skeletons finding: a network failure now leaves only the error.
- pg-conn: approved (36e8b6e). `pg-connection-string` is a direct dependency and LOCAL-DEV.md warns about `scripts/pg-connection.sh`.
- F1 Repeating shift dialog: approved (eb8b598). Checked in the browser at 375 and 1280 with DELETE calls intercepted: three choices for a series, two for a single shift, and Keep, Escape and clicking outside send nothing. The tenant isolation test failed once, fast, then passed twice; two runs sharing port 54329 is the likely cause, not proved.
- F2 Print code window: approved (9ee36f9). In real Chrome `print()` fires once with the page complete, the content and styles present and no CSP errors. The CSP has `script-src 'self'`, so the old inline script was blocked as the plan suspected. The print dialog itself cannot show in headless Chrome.
- A3 Dependencies and CSV writer: approved (3d60e16). Old and new writers match on all string and number inputs, and every export passes only those. Audit rerun: only zod remains (high, needs a breaking upgrade, in QUESTIONS.md). Follow-up asked for: array and object values no longer match json2csv, and an array can skip `neutralizeFormula`. No current export reaches this.
- A5 Dockerfile: approved (c9edde1). Production install in a scratch copy works, vendor files are made, no runtime use of dev dependencies, `.dockerignore` covers `.env` and `.env.*`. Image not built: Docker is not on this machine. The image now defaults to production, so a missing production variable stops boot.
- B1 Email fields: approved (a2c483f). All 6 email inputs in the frontend have all four attributes. No visual change.
- B3 Admin output escaping: approved (ee4a732). Fosters was the hole. Own static read of all 128 sinks, plus an injection sweep of 23 admin pages with writes blocked: 0 injected elements. A control on the old fosters.js gave 6, after a first control missed it because local data had no open request. Day sheet, onboarding and threads had no rows, so they rest on the static read.
- A3b CSV values: approved (699e7a1). Dates, objects and arrays match json2csv again, and an array can no longer skip the formula check.
- B5 Database TLS: approved (5d1deb9), after two rounds (1c40c74, 94a4458). Fixed along the way: `ssl` options in the URL overriding the CA inside `pg`, `?host=` giving no TLS to a remote host, a PEM with literal `\n` breaking every connection, and bundles losing certificates. Checked through `pg`'s own handling and a real local TLS server. Default unchanged. Not tested against real Supabase, which agents may not reach, so the first real proof is when Ryan sets `DB_SSL_CA`.
- I2 Tenant test isolation: approved (326d256). Two overlapping runs both passed and left no temp directories.
- B6 Audit sensitive reads: approved (c427974, 564d35a), after being sent back because its local test had no host check. Real profile views and admin downloads write rows on the local database with ids only. The test now skips unless `LOCAL_DB_REQUIRED=1` and refuses a remote host.
- B8 Kiosk time zone: approved (df0573a). Test passes with the server in four time zones.
- T1 Tenant table drift test: approved (59cbcc7). Removing a table in a copy turned it red.
- I3 GDPR erasure test: approved (7d5404a). It found that erasure, log out everywhere and password reset could leave sessions alive and report success, where `session` was created after migration 033. Test only, using a throwaway volunteer.
- I4 Session deletion: approved (b58dcb5). The delete runs through `runWithoutShelter`, with no permission change, and the tenant test no longer grants itself the right that hid the bug. Control on the local database: both tests pass with the fix and fail with `permission denied for table session` without it. Live not checked; the query for Ryan is in QUESTIONS.md. The local tests skip in `npm test`.
- I5 test:local script: approved (df359ff). Refuses a non-local host; plain `npm test` still touches no database.
- I6 Assisi walkthrough: approved (440b506). Findings only, gaps listed. Fixes picked as I7 to I10, second walk as I11. Hours refused for a future date is correct, not a bug. A kiosk session blocking normal sign-in is session behaviour, so it goes to Ryan.
- I7 Applying: sent back (f9ea5d6). `npm test` was red on the preload check. Every qualification with an expiry date counted as missing, so qualified volunteers lost Apply; the date bug is also on `main` for shift requirements. Also duplicate names, a repeated sentence, a wrong message for people already on the shift, and a notice off screen at 375.
- I8 Dead controls: approved (ccacba2). Approve confirms in a sentence, accepted rows have no Approve, the announcement link shows only where the form exists, and Complete your profile reaches the profile. The one red test is the preload check inherited from I7.
