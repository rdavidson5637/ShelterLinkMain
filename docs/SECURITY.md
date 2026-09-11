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

- User passwords are hashed with `bcrypt` before storage (`SALT_ROUNDS = 10`).
- Authentication compares hashed passwords using `bcrypt.compare`.
- Plain-text passwords are not persisted.

## 3) Session Security Configuration

- Sessions use `express-session` with `httpOnly` cookies.
- In production (`NODE_ENV=production`):
  - `cookie.secure = true`
  - `cookie.sameSite = 'strict'`
- Session max age is configured to limit session lifetime.

## 4) Rate Limiting

- `express-rate-limit` is enabled with:
  - `loginLimiter`: 5 login attempts per 15 minutes per IP on `POST /api/auth/login`.
  - `apiLimiter`: 100 requests per 15 minutes per IP across `/api` routes.
- These controls reduce credential stuffing and abusive API traffic.

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
(`memoryStorage`), size-capped at 5MB, then written to Postgres as `bytea`
(`user_documents.content`, `animal_photos.content`). Nothing is written to the
filesystem, so there is no path traversal surface and files survive redeploys.

- Documents accept PDF/JPG/PNG; animal photos accept JPG/PNG only.
- Every read goes through an authenticated route. Document download enforces
  owner-or-staff/admin; document/photo bytes are never selected by list or
  detail queries, only by the dedicated download/photo endpoints.
- Deleting a row deletes the bytes (same row / `ON DELETE CASCADE`).


