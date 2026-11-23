# Security Measures

This document summarizes the core backend security controls implemented in ShelterLink.

## 1) Parameterized SQL Queries

- All model-layer database operations use parameterized statements with `?` placeholders for variable values (via `pool.execute(sql, params)`).
- Direct string concatenation of user input into SQL is not used.
- Dynamic update/insert field construction is restricted with explicit allowlists:
  - `models/VolunteerProfile.js`: only approved profile fields are permitted.
  - `models/Opportunity.js`: only approved opportunity fields are permitted.
- Query review note:
  - A codebase search for backtick template literals in `pool.query(...)` calls found no matches.
  - Active DB calls use `pool.execute(...)` with parameter arrays.

## 2) Password Hashing (bcrypt)

- New passwords are hashed with `bcrypt` at cost 12 (`SALT_ROUNDS` in `utils/password.js`).
- A successful login outside tests re-hashes a stored password when its cost is below 12.
- Authentication compares hashed passwords using `bcrypt.compare`.
- Plain-text passwords are not persisted.
- A password must be at least 8 characters and include an uppercase letter and a number.
- Outside tests, registration, reset, and shelter setup also reject passwords that appear in the Have I Been Pwned range list. If that service cannot be reached, the password is accepted and the failure is logged. Set `PWNED_PASSWORD_CHECK=off` to skip the check.

## 3) Session Security Configuration

- Sessions use `express-session` with `httpOnly` cookies.
- In production (`NODE_ENV=production`):
  - `cookie.secure = true`
  - `cookie.sameSite = 'strict'`
- Session max age is configured to limit session lifetime.

## 4) Rate Limiting

- `express-rate-limit` is enabled with:
  - `loginAccountLimiter`: 5 failed login attempts per 15 minutes for one email, on `POST /api/auth/login` and kiosk unlock. Successful logins are not counted.
  - `loginLimiter`: 15 failed login attempts per 15 minutes per IP on the same routes.
  - `forgotAccountLimiter`: 5 password-reset requests per 15 minutes for one email, then the existing per-IP forgot-password limit.
  - `apiLimiter`: 300 requests per 15 minutes per IP across `/api` routes.
- In production, counters live in Postgres (`rate_limit_hits`) so multiple app replicas share one budget. Set `RATE_LIMIT_STORE=postgres` to enable that on a non-production host, or `RATE_LIMIT_STORE=memory` as an emergency override. Store errors fail open so a database blip does not block the site.
- The account limit is what stops guessing one password from many addresses. The IP limits are the ones the running app enforces.

## 4b) Scheduled job dedupe

- The in-process scheduler still skips a second tick in the same minute on one host.
- Before running, it claims `job_runs (job_name, run_key)` so a second replica loses the unique insert and skips that minute. Requires migration `046_rate_limit_job_dedupe.pg.sql`.

## 5) Input Sanitization

- Global sanitization middleware runs before route controllers.
- It sanitizes `req.body`, `req.query`, and `req.params` by:
  - trimming whitespace on all string values
  - escaping HTML with `xss`
  - validating `email` fields with `validator.isEmail`
- Invalid emails return HTTP 400.

## 6) Additional Security Headers and CORS

- `helmet()` is enabled to set common security headers (including CSP, HSTS, and frame protections).
- CORS is restricted to the configured frontend origin, with credentials enabled and methods limited to:
  - `GET`, `POST`, `PUT`, `DELETE`

## 7) Contact privacy (volunteer-to-volunteer)

ShelterLink guarantees that **volunteers never receive another volunteer's phone,
email, address, or emergency contact** through the API. The same rule applies to
messaging participants, foster offer lists, and swap flows.

- Staff and admin retain contact fields on roster, applications, exports, day
  sheets, and GDPR tools.
- Messaging (`/api/threads`) returns display names only for volunteers; contact
  fields are stripped server-side (`MessageThread.toVolunteerSafeParticipant`).
- Referee comments on AccessNI references are staff/admin only — never returned
  on volunteer vetting endpoints.
- Swap list/claim/cancel responses are sanitised via `utils/contactPrivacy.js`.
- Regression coverage: `test/contactPrivacy.test.js`, `test/threads.test.js`,
  `test/vetting.test.js`.
- When adding new volunteer-facing endpoints, strip contact fields before
  `res.json` and add a `hasContactLeak` assertion.

## 8) Uploads

Volunteer documents and animal photos are held in memory by `multer`
(`memoryStorage`), size-capped at 5MB, then stored either as Postgres `bytea`
(`user_documents.content`, `animal_photos.content`) or in an S3-compatible
bucket when `OBJECT_STORAGE_*` is fully configured (`storage_key` on the row,
`content` null). Nothing is written to the app filesystem, so there is no path
traversal surface. See `docs/OBJECT-STORAGE.md`.

- Documents accept PDF/JPG/PNG; animal photos accept JPG/PNG only.
- The stored type comes from the file signature (PDF, JPEG, or PNG bytes), and
  the upload is rejected when that signature does not match the declared type.
- Files whose name or label looks like an AccessNI, DBS, or disclosure
  certificate are rejected. An admin records the check status and reference
  number instead. Staff see status and dates only. See `docs/VETTING-DATA.md`.
- Every read goes through an authenticated route. Another person's documents
  can be listed or downloaded by an admin only. The owner can still download
  their own file. Document and photo bytes and storage keys are never selected
  by list or detail queries, only by the dedicated download and photo endpoints.
- Deleting a row deletes the bytes (same row / object delete / `ON DELETE CASCADE`).
  GDPR erase removes object-storage blobs before deleting document rows.

## 9) Login across shelters

- `users.email` is unique. `uq_users_email_lower` also rejects two emails that
  differ only by case. That index is in `schema.pg.sql`. On an existing
  database, `database/034_users_email_lower_unique.pg.sql` applies only after
  `BACKUP_CONFIRMED=yes`.
- Login, kiosk unlock, and forgot-password look up `lower(email)` and refuse
  the request when more than one row matches. They do not use `LIMIT 1`.

## 10) CSV exports

- String cells that start with `=`, `+`, `-`, `@`, tab, or a carriage return
  are prefixed with a single quote before the CSV is built, so spreadsheet
  apps treat them as text.

## 11) Backups

- `npm run backup` writes an AES-256-GCM file and refuses to write a plaintext
  dump. Set `BACKUP_ENCRYPTION_KEY`. Restore steps and the outstanding drill
  are in `docs/BACKUP-RESTORE.md`.

## 12) Dependency audit gate (CI)

- CI runs `npm run audit:deps` (`scripts/npm-audit-gate.js`) after `npm ci`.
- The gate calls `npm audit --omit=dev` and fails on **high** or **critical**
  advisories in production dependencies. Moderate and low findings do not fail
  the build. There is no paid scanning service.
- Exceptions live in `npm-audit-allowlist.json` at the repo root. Each row needs:
  - `id` — GHSA id (preferred) or npm advisory source number
  - `reason` — why the exception is accepted
  - `reviewBy` — ISO date (`YYYY-MM-DD`); **expired rows fail the gate** even
    if the advisory is gone, so stale exceptions get re-reviewed or removed
- Prefer a patch or minor upgrade over an allowlist entry. Do not jump major
  versions solely to clear an advisory without a planned migration.
- Current exception: `GHSA-mrhx-c7xc-m3w5` (zod < 4.6.6). The fix is only on
  zod 4.x; ShelterLink stays on zod 3.x for now, with body schemas already
  capping string length and array size. Review by the date in the allowlist.
- Local check: `npm run audit:deps`. Tests: `test/npmAuditGate.test.js`
  (included in `npm run test:security`).


