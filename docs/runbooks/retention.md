# Retention and erasure

Nothing in this runbook chooses a retention period. Each period stays empty until Assisi confirms it. An empty period is skipped.

## Periods

Set these in the environment when the periods are agreed. Leave them unset until then.

| Category | Variable | What a set value does |
|---|---|---|
| Inactive volunteer accounts | `RETENTION_INACTIVE_VOLUNTEER_YEARS` or `DATA_RETENTION_YEARS` | Anonymise the account. Approved hour rows stay. |
| Applications | `RETENTION_APPLICATION_YEARS` | Reported only. Applications are not deleted, because feedback, swaps and animal activity point at them. |
| Hours | `RETENTION_HOURS_YEARS` | Reported only. Hour rows are not deleted. |
| Audit log | `RETENTION_AUDIT_LOG_YEARS` | Delete audit rows older than the period. |
| Group booking requests | `RETENTION_GROUP_BOOKING_YEARS` | Delete booking rows older than the period. |
| Password reset tokens | none | Links expire after one hour. The hourly `resetTokenCleanup` job clears them once `reset_token_expires` has passed. `RETENTION_RESET_TOKEN_HOURS` is only an extra wait used by the manual sweep. Leave it unset. |

The nightly job uses the inactive-volunteer period only. While that value is empty, the job scans nothing and anonymises nothing. The reset-token job does not wait for a retention period.

## Dry run

Take a backup first (`npm run backup`). Then, against a copy of the database:

```bash
node scripts/retention-sweep.js
```

That prints the plan and changes nothing. Add `--apply` only on the copy, after you have read the plan. Do not pass `--apply` against production.

## Erasure

An admin erases one volunteer with `POST /api/admin/gdpr/volunteers/<id>/erase` and body `{ "confirmation": "DELETE" }`. Staff cannot call it.

The account name, email, phone and password are replaced. Profile, foster home fields, documents, references, push subscriptions and custom answers are removed. Message text, shift notes, foster-offer notes, background-check notes and matching group-booking contact details are blanked. Audit detail for that person is cleared. The new audit row records the user id and the hours kept, not the old name or email. The login session is ended. Approved hours stay.

Waiver acceptance rows stay, linked to the anonymised account, so there is still a record that a waiver was accepted.

## Still to confirm

TODO: the number of years or hours for each row in the table above.
