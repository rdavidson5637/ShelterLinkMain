# Questions for Ryan

Agents add questions here instead of stopping. Newest at the bottom.

## H1 Duplicate " 2" files (2 Nov 2026)

Compared each pair with `cmp`. Eleven copies matched the original byte for byte and were removed.

These five copies differ. Each copy is dated 22 Oct and the original is dated 26 Oct. The copy has nothing the original lacks. The original has later work the copy is missing. They are in `_to_delete/` and have not been deleted.

- `docs/BACKUP-RESTORE 2.md` is missing the pointer to `docs/runbooks/backup-and-restore.md` and the names `scripts/backup-db.sh`, `scripts/restore-db.sh`, and `scripts/verify-restore.sh`.
- `docs/VETTING-DATA 2.md` is missing who can see which background-check fields, the 60-day expiry list on the staff home, the rule that a required check must still be clear on the shift date, and the note that an audit row records a reference-number or notes change without storing the text.
- `middleware/validate 2.js` is missing `unrecognized_keys` handling in `zodFields`, and the `boundedParam` helper.
- `test/passwordPolicy.test 2.js` still expects the old rule (8 characters, one uppercase letter, one number) and treats `Password1` as acceptable. The original expects at least 10 characters, rejects `password12` as too common, and accepts `longpassword`.
- `utils/password 2.js` still uses the old 8-character rule with an uppercase letter and a number. The original uses a 10-character minimum, a common-password list, and a dummy bcrypt hash for login timing. The copy does not export `MIN_PASSWORD_LENGTH`, `COMMON_PASSWORD_MESSAGE`, `DUMMY_PASSWORD_HASH`, or `COMMON_PASSWORDS`.

Ryan: these five look like older copies with nothing unique. Delete `_to_delete/` when you are satisfied, or say if any of that old behaviour should be kept.

## Zod 4 (2 Nov 2026)

`npm audit fix` will not move `zod` off 3.25.76. The fix it offers is `zod@4.6.7`, and it says that is a breaking change. Left on 3. Say if you want the upgrade looked at separately.

## Today loads every application (2 Nov 2026)

Not blocking. `/applications` has no server-side limit. Today asks for the whole list and shows the first five. I1 stopped sending `?limit=5` because that query is rejected. A limit on the API would be a separate change.

## Sessions left alive after erasure (2 Nov 2026)

On a database where the `session` table was created after migration 033, erasure, log out everywhere, and password reset leave sessions alive while reporting success. Migration 033 grants the tenant role only the tables that exist when it runs. `connect-pg-simple` creates `session` later, so the tenant role cannot delete from it, and the error is swallowed.

Agents cannot check the live database. Ryan can check with:

`SELECT has_table_privilege('shelterlink_tenant', 'session', 'DELETE');`

`false` means the live database has this bug until the session delete runs outside the tenant role. Anyone erased or reset in the meantime should have their sessions cleared by hand.

A table added by a later migration needs its own grant. Do not grant `session` to the tenant role. That would let one shelter see every shelter's sessions.

## A valid qualification with an expiry date looks missing (2 Nov 2026)

On main, the shift list turns an expiry date into text like "Mon Nov 02" and compares it with an ISO date. Any real expiry then looks earlier, so a volunteer who holds the qualification is told they do not, and Apply is not offered. The same comparison is fixed on this branch for both shift requirements and animal requirements. It reaches the live site only after this branch is merged.

## Signing in while the kiosk is unlocked (2 Nov 2026)

The kiosk and a normal sign-in share one browser session. While the kiosk is unlocked, signing in is refused. The sign-in page now says to lock the kiosk first. The session rule is unchanged.

Ryan, two choices:

1. Leave the block. The tablet stays the kiosk until someone presses Lock, then a person can sign in.
2. Let a person sign in on that browser, and end the kiosk session as part of that sign-in.

## A reference link cannot be sent again (2 Nov 2026)

A reference request stores a hash of the link, not the link itself. If the email does not go, staff cannot send that same link again. The page now says the request was saved and the email did not go, and that the link cannot be sent again. A new request makes a second row and a new link. No resend was built.

## Hours dated before the shift (2 Nov 2026)

The server accepts hours for a date that is before the shift. A walk logged 1 hour on 1 Nov 2026 against a shift on 2 Nov, and it stayed Pending for staff to approve. A future date is already refused. This was not changed.

Ryan: should hours dated before the shift be refused, or is staff approval enough?

## Cover after check-in (2 Nov 2026)

A volunteer who has already checked in can ask someone else to cover the shift. The claim cancels the old application, and that cancelled row still shows as checked in. The new person is accepted and not checked in. This was not changed.

Ryan: should cover be refused once someone has checked in?

## Foster confirm now says whether the email went (2 Nov 2026)

Confirming a foster offer used to return the placement and an emergency phone number. It now also returns `volunteer_emailed`, true only when that email was sent. The page uses it so staff are not told an email went when it did not. This changes the response shape. Say if that field should be removed and the page should use another signal.

## No LICENSE file (2 Nov 2026)

`package.json` sets `"license": "MIT"`. There is no `LICENSE` file in the repo. Ryan: add one if the MIT text should sit in the tree.

## API limit of 300 (2 Nov 2026)

`apiLimiter` allows 300 requests per 15 minutes per IP across all of `/api`. Staff sharing a shelter connection could reach that, and it would stop everyone behind that address. A review of the phone-width notes hit this limit on the local server. The limit was not changed. Ryan: should it be raised, or keyed by user once signed in?
