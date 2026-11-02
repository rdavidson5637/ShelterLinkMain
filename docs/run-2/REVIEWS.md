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
- sheet-skeletons: sent back (2cb3965). After a network failure the skeleton rows stay on the page under the error. Otherwise fine at 375 and 1280.

## Run 2

- H1 Duplicate files: approved (2a14718). The eleven removed files cannot be re-compared now they are gone, so that part rests on Cursor's recorded `cmp` run.
- A2 Guard setup-db: approved (c760f01), after being sent back at b9d795e because `?host=`, `PGHOST`, a trailing dot and unparseable values got past the guard. Checked against `pg`'s own host resolution and with the real npm scripts on a `.invalid` host. To do: add `pg-connection-string` to `dependencies`.
- L1 Local Postgres: approved (42d1f7a, c760f01). 452 tests pass on an export with no `.env`. Signed-in sweep of 36 pages at 375 and 1280 clean apart from the two items now in I1. `scripts/pg-connection.sh` still reads `.env` directly for the backup shell scripts.
- I1 (approved to build): dashboard `?limit=5` is rejected with a 400, so Today always says "Could not load applications". Also on `main`; live site not checked. Certificate copy names a button that does not exist.
