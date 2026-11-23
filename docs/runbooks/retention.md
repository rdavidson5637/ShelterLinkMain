# Retention and erasure

Inactive-volunteer anonymisation is a per-shelter setting. It is off until an admin sets a number of months under Privacy settings. Other categories below stay empty until Assisi confirms them. An empty period is skipped.

## Inactive volunteers (per shelter)

| Setting | Where | What a set value does |
|---|---|---|
| Inactive volunteer accounts | Admin Privacy settings → `retention_inactive_months` on `shelter_settings` (migration `053`) | Anonymise volunteers in that shelter whose `COALESCE(last_login, created_at)` is older than N months. Approved hour rows stay. Null means off. |

Admins must open the preview list before running retention from the Privacy page. The daily `dataRetention` job is claimed through `job_runs` (scheduler `run_key`) and writes `gdpr.retention.job` to `audit_log` for every shelter it visits, including when the period is off (skipped).

## Other periods (environment)

Set these in the environment when the periods are agreed. Leave them unset until then. They are used by the manual sweep only; they do not drive the nightly inactive-volunteer job.

| Category | Variable | What a set value does |
|---|---|---|
| Applications | `RETENTION_APPLICATION_YEARS` | Reported only. Applications are not deleted, because feedback, swaps and animal activity point at them. |
| Hours | `RETENTION_HOURS_YEARS` | Reported only. Hour rows are not deleted. |
| Audit log | `RETENTION_AUDIT_LOG_YEARS` | Delete audit rows older than the period. |
| Group booking requests | `RETENTION_GROUP_BOOKING_YEARS` | Delete booking rows older than the period. |
| Password reset tokens | none | Links expire after one hour. The hourly `resetTokenCleanup` job clears them once `reset_token_expires` has passed. `RETENTION_RESET_TOKEN_HOURS` is only an extra wait used by the manual sweep. Leave it unset. |

`RETENTION_INACTIVE_VOLUNTEER_YEARS` / `DATA_RETENTION_YEARS` are legacy env names. Prefer the per-shelter months setting.

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

TODO: the number of months each shelter wants for inactive volunteers, and the years or hours for each env row above.
