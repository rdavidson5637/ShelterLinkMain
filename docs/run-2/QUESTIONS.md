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
