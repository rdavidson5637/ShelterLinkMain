# ShelterLink recon (read only)

Date: 2026-10-22. No code was changed. Facts below are from the files named. Where something is inferred, it is marked as such.

The prompt for this pass assumed MySQL. This codebase uses Postgres (`pg`). `database/schema.sql` is an older MySQL script and is not what `scripts/setup-db.js` applies.

## 1. Stack

| Piece | What the repo says |
|---|---|
| Node | `>=22` in `package.json` engines. `.nvmrc` is `22`. `Dockerfile` is `node:22-alpine`. CI uses `node-version-file: .nvmrc`. |
| Express | Declared `^4.21.2`. Lockfile resolves `4.22.1` (`package-lock.json` around the `node_modules/express` entry). |
| Database driver | `pg` `8.23.0` (lockfile). `config/database.js` exposes a small mysql2-shaped `pool.execute` / `pool.query` adapter on top of `pg`. There is no `mysql` or `mysql2` dependency. |
| Sessions | `express-session` `1.18.2` with `connect-pg-simple` `10.0.0`. Store table is created by the library (`createTableIfMissing: true` in `server.js` lines 99-103). Not JWT. |
| Password hashing | `bcrypt` `6.0.0`. Cost 12 in `utils/password.js` line 6. |
| Headers | `helmet` `8.1.0`, configured in `server.js` lines 29-33 with directives from `utils/csp.js`. |
| CORS | `cors` `2.8.5`. Allow-list in `utils/corsOrigins.js` (`APP_URL`, optional `CORS_ORIGINS`). |
| Rate limiting | `express-rate-limit` `8.7.1`. Limits are constants in `middleware/rateLimiter.js` lines 7-17, not env vars. The general API cap is raised to 10000 when `NODE_ENV=test` (line 46). |
| Validation / XSS | `validator` `13.15.26`. `xss` `^1.0.15` (declared). Used in `middleware/sanitize.js` line 18. No `zod` or `express-validator` in `package.json`. |
| Email | `nodemailer` `10.2.0`. SMTP from `EMAIL_*`. Transport is built once at load time in `utils/emailService.js` lines 21-34. |
| Uploads | `multer` `2.4.0`. Animal photos and volunteer documents are stored as `bytea`, not on disk (`DEPLOY.md` lines 63-66; `user_documents.content` and `animal_photos.content` in `database/schema.pg.sql`). |
| Other security-adjacent | `dotenv` `^16.6.1`. `web-push` `3.6.7` (VAPID). `compression` `^1.8.2`. `json2csv` for admin CSV export. Have I Been Pwned check in `utils/pwnedPassword.js`, skipped in test or when `PWNED_PASSWORD_CHECK=off` (`utils/password.js` lines 18-26). |

No argon2. No JWT library.

## 2. Entry points and configuration

Start: `npm start` runs `node server.js` (`package.json` line 13). `server.js` calls `dotenv.config()` then `validateEnv()` (lines 21-22). If this file is the main module it calls `startServer()` (lines 299-301), which tests the database, starts the in-process scheduler unless `NODE_ENV=test`, and listens.

Static files: `express.static` serves the `frontend/` directory (`server.js` lines 67-80). `/` sends `frontend/index.html`. `/kiosk` sends `frontend/kiosk.html`. `/launch` is `controllers/launchController.js`. `/sw.js` is built from `frontend/sw.js` and is not the static copy. Two stale paths are forced to 404: `/public/js/config.js` and `/public/js/auth.js` (lines 49-54).

`trust proxy` is `1` (`server.js` line 27). Helmet is mounted, which removes `X-Powered-By`. I did not see a separate `app.disable('x-powered-by')`.

Production startup refuses to continue if `SESSION_SECRET` is missing (`server.js` lines 93-97), and, when `NODE_ENV=production`, if `SESSION_SECRET`, `ADMIN_REGISTRATION_KEY`, or `APP_URL` is blank, too short, matches a weak pattern, or (for `APP_URL`) points at localhost (`utils/validateEnv.js` lines 26-38, 73-80). Email, VAPID keys, and `SHELTER_EMERGENCY_PHONE` are warnings only.

Env names the app reads (names only):

- Server: `PORT`, `NODE_ENV`, `APP_URL`, `CORS_ORIGINS`
- Database: `DATABASE_URL`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`, `DB_CONNECTION_LIMIT`, `DB_IDLE_TIMEOUT_MS`
- Secrets: `SESSION_SECRET`, `FEEDBACK_TOKEN_SECRET`, `ADMIN_REGISTRATION_KEY`, `ALLOW_ADMIN_REGISTRATION`, `BACKUP_ENCRYPTION_KEY`, `BACKUP_CONFIRMED`, `CONFIRM_LIVE_SHELTER`, `PWNED_PASSWORD_CHECK`
- Email: `EMAIL_HOST`, `EMAIL_PORT`, `EMAIL_USER`, `EMAIL_PASS`, `EMAIL_FROM`, `ADMIN_EMAIL`
- Shelter / push: `SHELTER_EMERGENCY_PHONE`, `SHELTER_TIMEZONE`, `WEB_PUSH_VAPID_PUBLIC_KEY`, `WEB_PUSH_VAPID_PRIVATE_KEY`, `WEB_PUSH_VAPID_SUBJECT`, and aliases `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`
- Retention: `DATA_RETENTION_YEARS`
- Deploy hints read for the service-worker version only: `RENDER_GIT_COMMIT`, `RAILWAY_GIT_COMMIT_SHA`, `SOURCE_VERSION`, `GIT_COMMIT`
- Scripts and tests, not the request path: `SMOKE_BASE_URL`, `SMOKE_ADMIN_EMAIL`, `SMOKE_ADMIN_PASSWORD`, `TENANT_DATABASE_URL`, `PG_BIN`

`DEPLOY.md` also tells the operator to set `TZ`. I did not find `process.env.TZ` in application code. `utils/scheduler.js` uses the process clock.

`.env` and `.env.*` are gitignored, with `!.env.example` (`.gitignore` lines 14-16 and again at 67-69). `.env.example` lists the main variables. It does not list `ADMIN_EMAIL`, `CONFIRM_LIVE_SHELTER`, `BACKUP_CONFIRMED`, or the VAPID aliases.

## 3. Routes

Every `/api` request passes, in order: JSON/urlencoded parsers, `Cache-Control: no-store`, the session middleware, `sanitizeInput`, `apiLimiter` (300 per 15 minutes, or 10000 in test), `restrictKioskSession`, and `bindShelter` (`server.js` lines 82-127). `bindShelter` (`middleware/shelter.js` lines 54-69) loads the user from `req.session.userId` and sets the shelter from that row. If the body, query, or params contain `shelter_id` or `shelterId`, it returns 400. Unauthenticated requests skip the shelter bind and continue.

Kiosk sessions are rejected for any `/api` path that is not under `/kiosk` (`middleware/auth.js` lines 96-106).

Role helpers (`middleware/auth.js`): `volunteer`, `staff`, `admin` are the only `users.role` values (`schema.pg.sql` lines 77-78). `requireStaff` is staff or admin. `requireRole('admin')` is admin only. `isAuthenticated` checks `req.session.userId` and reloads the user. It does not check a role. There is no separate "approved volunteer" middleware on the routers; approval is enforced inside some controllers (not fully traced in this pass).

The table lists route-level middleware on top of the global `/api` stack. "Login" means `isAuthenticated` or an equivalent session check inside the handler.

### Auth — `/api/auth` (`routes/auth.js`)

| Method | Path | Extra middleware | Login | Who |
|---|---|---|---|---|
| POST | `/api/auth/register` | `registerLimiter` (8 / 15 min) | no | public. Creates `role = 'volunteer'` in the Assisi shelter (`controllers/authController.js` lines 62-66). Returns 409 if the email exists (line 56). |
| POST | `/api/auth/register-admin` | `adminRegistrationEnabled` | no | Always 404 in production, and 404 unless `ALLOW_ADMIN_REGISTRATION=true` (`routes/auth.js` line 15, controller lines 203-205). Needs `admin_key`. |
| POST | `/api/auth/login` | `loginAccountLimiter` (5 / email / 15 min), `loginLimiter` (15 / IP / 15 min, failures only) | no | public |
| POST | `/api/auth/logout` | none | no | Destroys the current session cookie if one is present. |
| POST | `/api/auth/logout-all` | `isAuthenticated` | yes | that user. Deletes rows in `session` for the user id, then destroys this session. |
| GET | `/api/auth/me` | `isAuthenticated` | yes | that user |
| POST | `/api/auth/forgot-password` | `forgotAccountLimiter`, `forgotPasswordLimiter` (5 / 15 min) | no | public. Same 200 body whether or not the email exists (lines 279-292). |
| GET | `/api/auth/reset-password/:token` | `resetPasswordLimiter` | no | public. Returns `{ valid: true/false }` only. |
| POST | `/api/auth/reset-password` | `resetPasswordLimiter` | no | public, needs the reset token |

### Volunteer profile — `/api/volunteer` (`routes/profile.js`)

`router.use(isAuthenticated)` on the router.

| Method | Path | Extra middleware | Login | Who |
|---|---|---|---|---|
| POST | `/api/volunteer/profile` | none beyond auth | yes | any logged-in user |
| GET | `/api/volunteer/profile` | none beyond auth | yes | any logged-in user |
| PUT | `/api/volunteer/profile` | none beyond auth | yes | any logged-in user |
| GET | `/api/volunteer/badges` | none beyond auth | yes | any logged-in user |
| GET | `/api/volunteer/certificate` | none beyond auth | yes | any logged-in user |
| POST | `/api/volunteer/certificate` | none beyond auth | yes | any logged-in user |

### Opportunities — `/api/opportunities`

| Method | Path | Extra middleware | Login | Who |
|---|---|---|---|---|
| POST | `/api/opportunities/` | `requireStaff`, `auditMutations` | yes | staff, admin |
| GET | `/api/opportunities/` | none | yes | any logged-in user |
| GET | `/api/opportunities/:id/notes` | none | yes | any logged-in user |
| POST | `/api/opportunities/:id/notes` | `requireStaff`, `auditMutations` | yes | staff, admin |
| DELETE | `/api/opportunities/:id/notes/:noteId` | `requireRole('admin')`, `auditMutations` | yes | admin |
| GET | `/api/opportunities/:id` | none | yes | any logged-in user |
| PUT | `/api/opportunities/:id` | `requireStaff`, `auditMutations` | yes | staff, admin |
| DELETE | `/api/opportunities/:id` | `requireStaff`, `auditMutations` | yes | staff, admin |
| POST | `/api/opportunities/:id/clone` | `requireStaff`, `auditMutations` | yes | staff, admin |
| POST | `/api/opportunities/:id/urgent` | `requireStaff`, `auditMutations` | yes | staff, admin |

### Applications — `/api/applications`

| Method | Path | Extra middleware | Login | Who |
|---|---|---|---|---|
| POST | `/api/applications/` | none | yes | any logged-in user |
| GET | `/api/applications/my-applications` | none | yes | any logged-in user |
| GET | `/api/applications/swaps/available` | none | yes | any logged-in user |
| POST | `/api/applications/swaps/claim-by-token` | none | yes | any logged-in user |
| POST | `/api/applications/swaps/:id/claim` | none | yes | any logged-in user |
| DELETE | `/api/applications/swaps/:id` | none | yes | any logged-in user |
| POST | `/api/applications/:id/swap` | none | yes | any logged-in user |
| GET | `/api/applications/` | `requireStaff` | yes | staff, admin |
| PUT | `/api/applications/:id` | `requireStaff`, `auditMutations` | yes | staff, admin |
| PATCH | `/api/applications/:id/no-show` | `requireStaff`, `auditMutations` | yes | staff, admin |
| POST | `/api/applications/:id/check-in` | none | yes | any logged-in user |
| POST | `/api/applications/:id/check-out` | none | yes | any logged-in user |
| DELETE | `/api/applications/:id` | none | yes | any logged-in user |

Object-level checks (own application vs any id) are inside controllers. Not verified route by route in this pass.

### Hours — `/api/hours`

| Method | Path | Extra middleware | Login | Who |
|---|---|---|---|---|
| POST | `/api/hours/` | none | yes | any logged-in user |
| GET | `/api/hours/my-hours` | none | yes | any logged-in user |
| GET | `/api/hours/pending` | `requireStaff` | yes | staff, admin |
| PUT | `/api/hours/:id/approve` | `requireStaff`, `auditMutations` | yes | staff, admin |
| GET | `/api/hours/stats` | none | yes | any logged-in user |

### Admin — `/api/admin`

`router.use(auditMutations)` on the whole router (`routes/admin.js` line 33).

| Method | Path | Extra middleware | Login | Who |
|---|---|---|---|---|
| GET | `/api/admin/day-sheet` | `requireStaff` | yes | staff, admin |
| GET | `/api/admin/week-sheet` | `requireStaff` | yes | staff, admin |
| GET | `/api/admin/week-sheet.ics` | `requireStaff` | yes | staff, admin |
| GET | `/api/admin/stats` | `requireStaff` | yes | staff, admin |
| GET | `/api/admin/stats/leaderboard` | `requireStaff` | yes | staff, admin |
| GET | `/api/admin/stats/monthly-hours` | `requireStaff` | yes | staff, admin |
| GET | `/api/admin/volunteers` | `requireStaff` | yes | staff, admin |
| GET | `/api/admin/volunteers/:userId` | `requireStaff` | yes | staff, admin |
| PUT | `/api/admin/volunteers/:userId/approval` | admin only | yes | admin |
| PUT | `/api/admin/volunteers/:userId/foster-approval` | `requireStaff` | yes | staff, admin |
| PUT | `/api/admin/volunteers/:userId/service-settings` | `requireStaff` | yes | staff, admin |
| GET | `/api/admin/volunteers/:userId/qualifications` | `requireStaff` | yes | staff, admin |
| POST | `/api/admin/volunteers/:userId/qualifications` | `requireStaff` | yes | staff, admin |
| DELETE | `/api/admin/volunteers/:userId/qualifications/:qualificationId` | `requireStaff` | yes | staff, admin |
| GET | `/api/admin/volunteers/:userId/custom-fields` | `requireStaff` | yes | staff, admin |
| GET | `/api/admin/volunteers/:userId/waivers` | `requireStaff` | yes | staff, admin |
| GET | `/api/admin/volunteers/:userId/documents` | admin only | yes | admin |
| GET | `/api/admin/messages/recipients` | admin only | yes | admin |
| GET | `/api/admin/messages` | admin only | yes | admin |
| POST | `/api/admin/messages` | admin only, `messageLimiter` (10 / 15 min) | yes | admin |
| GET | `/api/admin/audit-log` | admin only | yes | admin |
| GET | `/api/admin/gdpr/volunteers/:userId/export` | admin only | yes | admin |
| POST | `/api/admin/gdpr/volunteers/:userId/erase` | admin only | yes | admin |
| POST | `/api/admin/gdpr/retention/run` | admin only | yes | admin |
| PUT | `/api/admin/users/:userId/role` | admin only | yes | admin |

### Export — `/api/export`

| Method | Path | Extra middleware | Login | Who |
|---|---|---|---|---|
| GET | `/api/export/volunteers` | admin, `auditMutations` | yes | admin |
| GET | `/api/export/hours` | admin, `auditMutations` | yes | admin |
| GET | `/api/export/community-service` | admin, `auditMutations` | yes | admin |
| GET | `/api/export/my-hours` | none | yes | any logged-in user |

### Public — `/api/public`

No `isAuthenticated`. Each handler has `apiLimiter` again (the global limiter already ran).

| Method | Path | Login | Notes |
|---|---|---|---|
| GET | `/api/public/config` | no | Demo emails and passwords only when `NODE_ENV !== 'production'` (`controllers/publicConfigController.js` lines 22-27). |
| GET | `/api/public/brand` | no | branding |
| GET | `/api/public/brand/logo` | no | logo bytes |
| GET | `/api/public/demo-info` | no | same handler as `/config` |
| GET | `/api/public/opportunities` | no | open shifts |
| GET | `/api/public/opportunities.ics` | no | public calendar |
| GET | `/api/public/references/:token/logo` | no | token in the path |
| GET | `/api/public/references/:token` | no | token in the path |
| POST | `/api/public/references/:token` | no | referee submits a reference |
| GET | `/api/public/verify-certificate/:code` | no | certificate lookup by code |

### Stats — `/api/stats`

All three require login and no extra role: `GET /me`, `GET /leaderboard`, `GET /monthly-hours`.

### Qualifications — `/api/qualifications`

| Method | Path | Extra middleware | Login | Who |
|---|---|---|---|---|
| GET | `/api/qualifications/` | none | yes | any logged-in user |
| GET | `/api/qualifications/mine` | none | yes | any logged-in user |
| POST | `/api/qualifications/` | admin, `auditMutations` | yes | admin |
| PUT | `/api/qualifications/:id` | admin, `auditMutations` | yes | admin |
| DELETE | `/api/qualifications/:id` | admin, `auditMutations` | yes | admin |

### Custom fields — `/api/custom-fields`

List and `/active` are any logged-in user. Create, reorder, update, deactivate, and delete are admin plus `auditMutations`.

### Waivers — `/api/waivers`

| Method | Path | Extra middleware | Login | Who |
|---|---|---|---|---|
| GET | `/api/waivers/pending` | none | yes | any logged-in user |
| POST | `/api/waivers/:id/accept` | none | yes | any logged-in user |
| GET | `/api/waivers/` | admin | yes | admin |
| POST | `/api/waivers/` | admin, `auditMutations` | yes | admin |
| PUT | `/api/waivers/:id` | admin, `auditMutations` | yes | admin |

### Documents — `/api/documents`

| Method | Path | Extra middleware | Login | Who |
|---|---|---|---|---|
| GET | `/api/documents/mine` | none | yes | any logged-in user |
| POST | `/api/documents/` | multer `file` | yes | any logged-in user |
| GET | `/api/documents/:id/download` | none | yes | any logged-in user. Ownership was not checked at the route. |
| PUT | `/api/documents/:id` | admin, `auditMutations` | yes | admin |
| DELETE | `/api/documents/:id` | none | yes | any logged-in user. Ownership was not checked at the route. |

### Tags — `/api/tags`

`router.use(isAuthenticated)`. `GET /` and `GET /recommended`. No role check.

### Feedback — `/api/feedback`

| Method | Path | Extra middleware | Login | Who |
|---|---|---|---|---|
| GET | `/api/feedback/` | none | no | signed token (`routes/feedback.js` line 17) |
| POST | `/api/feedback/` | none | no | signed token |
| GET | `/api/feedback/my-past-shifts` | none | yes | any logged-in user |
| GET | `/api/feedback/link/:applicationId` | none | yes | any logged-in user |
| GET | `/api/feedback/admin` | `requireStaff` | yes | staff, admin |
| PATCH | `/api/feedback/admin/:id/handled` | `requireStaff`, `auditMutations` | yes | staff, admin |

### Group bookings — `/api/group-bookings`

| Method | Path | Extra middleware | Login | Who |
|---|---|---|---|---|
| POST | `/api/group-bookings/` | `groupBookingLimiter` (8 / 15 min) | no | public form |
| GET | `/api/group-bookings/` | `requireStaff` | yes | staff, admin |
| POST | `/api/group-bookings/:id/confirm` | `requireStaff`, `auditMutations` | yes | staff, admin |
| POST | `/api/group-bookings/:id/decline` | `requireStaff`, `auditMutations` | yes | staff, admin |

### Kiosk — `/api/kiosk`

| Method | Path | Extra middleware | Login | Who |
|---|---|---|---|---|
| POST | `/api/kiosk/unlock` | login account + IP limiters | no | staff/admin password check is inside `unlockKiosk` (not re-read line by line past the query). Sets `kioskMode` on the session. |
| GET | `/api/kiosk/status` | none | no | 401 unless `session.kioskMode` (`controllers/kioskController.js` lines 94-98). Returns `userId` and `role`. |
| POST | `/api/kiosk/lock` | none | no | Destroys whatever session cookie is sent (lines 286-296). Same effect as logout for a normal browser session. |
| GET | `/api/kiosk/shifts/today` | `requireKiosk` | kiosk session | kiosk |
| POST | `/api/kiosk/applications/:id/check-in` | `requireKiosk` | kiosk session | kiosk |
| POST | `/api/kiosk/applications/:id/check-out` | `requireKiosk` | kiosk session | kiosk |

### Animals — `/api/animals`

| Method | Path | Extra middleware | Login | Who |
|---|---|---|---|---|
| GET | `/api/animals/me/helped` | none | yes | any logged-in user |
| GET | `/api/animals/` | `requireStaff` | yes | staff, admin |
| POST | `/api/animals/` | `requireStaff`, `auditMutations` | yes | staff, admin |
| GET | `/api/animals/:id` | none | yes | any logged-in user |
| PUT | `/api/animals/:id` | `requireStaff`, `auditMutations` | yes | staff, admin |
| GET | `/api/animals/:id/photo` | none | yes | any logged-in user |
| POST | `/api/animals/:id/photo` | `requireStaff`, `auditMutations`, multer | yes | staff, admin |
| POST | `/api/animals/:id/activity` | none | yes | any logged-in user |

### Fosters — `/api/fosters`

Volunteer (any logged-in user): `GET /emergency-phone`, `GET /matching`, `GET /my-placements`, `POST /placements/:id/check-in`, `POST /requests/:id/offers`.

Staff or admin, most with `auditMutations`: `GET /placements`, `POST /placements/:id/end`, `GET/POST /requests`, `GET/PUT /requests/:id`, `POST /requests/:id/cancel`, `GET /requests/:id/offers`, `POST /offers/:offerId/confirm`.

`GET /emergency-phone` returns `SHELTER_EMERGENCY_PHONE` (`controllers/fosterController.js` line 29). It is behind login, not a role check.

### Transport — `/api/transport`

Any logged-in user: `GET /legs/open`, `GET /legs/mine`, `POST /legs/:legId/claim`, `POST /legs/:legId/complete`, `GET /:id`.

Staff or admin: `PUT /legs/:legId/expense`, `GET /mileage`, `GET /`, `POST /`, `PUT /:id/status`, `POST /:id/chase`. Mutations use `auditMutations`.

### Incidents — `/api/incidents`

All six routes (`GET /`, `POST /`, `GET /:id`, `PUT /:id`, `POST /:id/resolve`, `DELETE /:id`) are `requireStaff`. Mutations use `auditMutations`.

### Threads — `/api/threads`

`router.use(isAuthenticated)`. No role middleware.

| Method | Path | Extra middleware |
|---|---|---|
| GET | `/api/threads/unread-count` | none |
| GET | `/api/threads/` | none |
| POST | `/api/threads/` | `messageLimiter`, `auditMutations` |
| GET | `/api/threads/:id` | none |
| POST | `/api/threads/:id/messages` | `messageLimiter`, `auditMutations` |
| DELETE | `/api/threads/:id/messages/:messageId` | `auditMutations` |
| POST | `/api/threads/:id/read` | none |
| POST | `/api/threads/:id/mute` | none |

### Vetting — `/api/vetting`

`router.use(auditMutations)` on the whole router, including GETs.

Volunteer: `GET /me/references`, `GET /me/background-checks`, `GET /me/onboarding`.

Staff or admin: `GET /admin/pipeline`, `GET /admin/expiring`, `GET/POST /volunteers/:userId/references`, `GET/POST /volunteers/:userId/background-checks`, `PUT /volunteers/:userId/background-checks/:id`.

### Push — `/api/push`

| Method | Path | Login | Who |
|---|---|---|---|
| GET | `/api/push/vapid-public-key` | no | public key only |
| POST | `/api/push/subscribe` | yes | any logged-in user |
| POST | `/api/push/unsubscribe` | yes | any logged-in user |
| POST | `/api/push/test` | yes | any logged-in user, `pushTestLimiter` (3 / hour / user) |
| GET | `/api/push/prefs` | yes | any logged-in user |
| PUT | `/api/push/prefs` | yes | any logged-in user |

### Opportunity templates — `/api/opportunity-templates`

`auditMutations` and `isAuthenticated` + `requireStaff` on the router. `GET /`, `POST /`, `POST /from-form`, `GET /:id`, `DELETE /:id`. Staff or admin.

### Routes mounted in `server.js`

| Method | Path | Login | Notes |
|---|---|---|---|
| GET | `/api/my-shifts.ics` | no | Requires `?token=` matching `users.ical_token` (`controllers/publicController.js` lines 229-238). Returns that user's upcoming accepted shifts. |
| GET | `/api/me/ical-feed` | yes | Returns the raw token and a URL (`lines 212-221`). |
| GET | `/api/applications/:id/ics` | yes | Handler also checks the application belongs to the session user (lines 275-279). |
| GET | `/healthz` | no | `{ db: true }` or 503 `{ db: false }`. Runs `SELECT 1`. |
| GET | `/` | no | `frontend/index.html` |
| GET | `/kiosk` | no | `frontend/kiosk.html` |
| GET | `/launch` | no | launch controller |
| GET | `/api` | no | Body is the text `ShelterLink API Running` (`server.js` lines 212-214). No obvious product reason. |
| GET | `/sw.js` | no | generated service worker |

Unknown `/api/*` falls through to the error handler as `not_found` (lines 217-221). Other unknown paths get `frontend/pages/error/404.html`.

**Public with no strong reason:** `GET /api`. Low impact (a banner string). `POST /api/kiosk/lock` is intentionally callable without a kiosk flag, and it destroys the caller's session. That is the same outcome as logout, so it is not an open admin action, but it is wider than "lock the tablet".

## 4. Auth

Login (`controllers/authController.js` `login`, lines 79-156):

- Looks up `lower(email)`. Zero or many rows: 401 `Invalid credentials`. Exactly one row: `bcrypt.compare`.
- On success, `regenerateSession` (`utils/sessionCookie.js` lines 29-46) replaces the session id and stores `userId`, `role`, `shelterId`.
- Cookie name `connect.sid`. Flags from `sessionCookieOptions`: `httpOnly: true`, `secure` only when `NODE_ENV=production`, `sameSite: 'strict'` in production and `'lax'` otherwise, `path: '/'`. Default `maxAge` is 1 hour (`server.js` line 113) with `rolling: true`. `rememberMe` sets 30 days for volunteers and 8 hours for staff and admin (controller lines 112-118).
- `resave: false`, `saveUninitialized: false`. Secret is `SESSION_SECRET` only. No fallback.
- Session rows live in Postgres via `connect-pg-simple`.
- Response strips `password`, `reset_token`, `reset_token_expires`, and `shelter_id` (`respondSafeUser`, lines 25-28). It still returns name, email, and role.
- Failed login and unknown email share the 401 message. Timing is not equalised: bcrypt runs only when a user row exists.
- Registration tells the caller when an email is already in use (409). Forgot-password does not.

Logout destroys the server session and clears the cookie (`logout`, lines 182-198). `logout-all` also deletes `session` rows whose JSON `userId` matches (`utils/sessionCookie.js` lines 49-59).

Password hashing: bcrypt, 12 rounds (`utils/password.js`). On login, a hash with fewer rounds is rewritten (controller lines 120-127), except in test. Policy in code today: at least 8 characters, one uppercase letter, one number (lines 7-11), plus a breach check unless disabled. That is not "minimum 10, no composition rules".

Password reset (`utils/resetToken.js`, controller lines 277-446):

- Token is 32 random bytes, hex. Only the SHA-256 hash is stored in `users.reset_token`.
- Expiry is 1 hour (controller line 311).
- `resetPassword` clears the token and calls `destroyUserSessions`.
- Email failure rolls the token back (lines 355-361).
- I did not find a separate "change password while logged in" path, so I cannot say a normal password change invalidates outstanding reset tokens. Reset itself does.
- No email-verification flow. Search for `email_verified`, `verify-email`, and `verification token` returned nothing.

Kiosk unlock is a second login that sets `req.session.kioskMode`. I did not finish reading which roles `unlockKiosk` accepts. The route file does not check a role before the controller.

`attachUser` prefers the live `users.role` over the session role (`middleware/auth.js` lines 8-12), so a role change is visible on the next request without a new login.

## 5. Database

Fresh installs run `database/schema.pg.sql` (`scripts/setup-db.js` lines 5 and 85). That file drops and recreates tables. Incremental upgrades use `database/0xx_*.pg.sql` via `scripts/migrate.js`.

`scripts/migrate.js` lines 8-9 say `schema.pg.sql` already includes every change. That comment is wrong for tenancy. `CREATE TABLE shelters` and `shelter_id` are in `database/033_add_shelters.pg.sql` only. They are not in the `CREATE TABLE` list in `schema.pg.sql`. A database built only with `npm run db:setup` would not match the running app, which reads `users.shelter_id` and `shelters`.

`database/schema.sql` is MySQL (`CREATE TABLE \`users\``) and includes a `sessions` table. Treat it as legacy. The live session table is the one `connect-pg-simple` creates, named `session` (see the `DELETE FROM session` in `utils/sessionCookie.js` line 54).

### Tables in `schema.pg.sql`

Session storage and `shelters` are extra, as above. `034_users_email_lower_unique.pg.sql` matches the unique index already in `schema.pg.sql` line 91. `migrate.js` skips `034_*` unless `BACKUP_CONFIRMED=yes`.

| Table | Columns (personal data called out) | Foreign keys |
|---|---|---|
| `users` | `first_name`, `last_name`, `name`, `phone`, `email`, `password` (hash), `role`, `last_login`, `anonymised_at`, `reset_token` (hash), `reset_token_expires`, `ical_token` | none in the base file. `033` adds `shelter_id` → `shelters.id` |
| `opportunities` | shift text, location, dates, `check_in_code` | `created_by` → `users`, `parent_opportunity_id` → `opportunities` |
| `volunteer_profiles` | `date_of_birth`, `address`, `emergency_contact`, skills, availability, approval, foster home fields (`home_type`, garden, other dogs/cats, `has_children_under_16`, `can_medicate`, `foster_notes`), `away_until`, email prefs | `user_id` → `users` ON DELETE CASCADE |
| `applications` | status, notes, rejection reason, check-in times | `user_id` → `users`, `opportunity_id` → `opportunities` |
| `shift_feedback` | rating, `comment`, concern flag | `application_id` → `applications` |
| `swap_requests` | swap token fields (not re-listed column by column) | `application_id`, `claimed_by_application_id` → `applications`; `waitlist_offered_to_user_id` → `users` |
| `volunteer_hours` | hours worked, approval | `user_id` → `users`, `opportunity_id` → `opportunities` |
| `job_runs` | job name, status, `detail` text. `033` says this table stays global (no `shelter_id`) | none |
| `qualifications` | name | none in base file |
| `volunteer_qualifications` | award and expiry | `user_id` → `users`, `qualification_id` → `qualifications`, `awarded_by` → `users` |
| `opportunity_qualifications` | link | opportunity, qualification |
| `tags` | name | none |
| `volunteer_tags` | link | `user_id`, `tag_id` |
| `opportunity_tags` | link | opportunity, tag |
| `opportunity_match_queue` | match queue | opportunity, user |
| `tag_digest_log` | last digest | `user_id` |
| `custom_fields` | field definitions | none |
| `custom_field_values` | free-text `value` per user. Can hold personal data if staff add such a field | `field_id`, `user_id` |
| `waivers` | title, body, version | none |
| `waiver_acceptances` | when a user accepted | `waiver_id`, `user_id` |
| `user_documents` | `filename`, `original_name`, `mime_type`, `label`, `expires_at`, `content` bytea (AccessNI and similar) | `user_id` → `users` CASCADE |
| `admin_messages` | subject, body, filter JSON, recipient count | `admin_id` → `users` |
| `audit_log` | action, entity, `detail_json`. May contain personal data depending on what callers write. Not sampled. | `user_id` → `users` SET NULL |
| `group_bookings` | `group_name`, `contact_name`, `contact_email`, `notes`, size, status | `opportunity_id` |
| `animals` | animal `name`, species, breed, sex, animal `date_of_birth`, notes, handling notes. This date of birth is the animal's. | `requires_qualification_id` → `qualifications` |
| `opportunity_animals` | link | opportunity, animal |
| `animal_activity` | activity type, notes | animal, `user_id`, optional application |
| `animal_photos` | image bytes | `animal_id` |
| `foster_requests` | urgency, dates, description | animal, `created_by` → `users` |
| `foster_offers` | `note` | request, `user_id` |
| `foster_placements` | dates, `notes` | animal, `user_id`, optional request |
| `transport_runs` | title, date, notes | animal, `created_by` |
| `transport_legs` | from/to locations, times, miles, notes | run, `claimed_by` → `users` |
| `incidents` | `body`, severity. Schema allows only `visibility = 'staff_only'` | animal, opportunity, `reported_by`, `resolved_by` |
| `message_threads` | subject, context | `created_by` → `users` |
| `thread_participants` | read/mute | thread, `user_id` |
| `messages` | `body` | thread, `user_id`, `deleted_by` |
| `message_digest_log` | digest hour | `user_id` |
| `shift_notes` | `body` | opportunity, `author_id` → `users` |
| `certificates` | public `code`, hours and shifts at issue | `user_id` |
| `volunteer_references` | `referee_name`, `referee_email`, `referee_relationship`, `comments`, suitability, `token_hash` | `user_id` |
| `background_checks` | check type, `reference_number`, issued/expires, status, `notes` | `user_id`, `updated_by` |
| `push_subscriptions` | `endpoint`, `p256dh`, `auth`, `user_agent` | `user_id` |
| `opportunity_templates` | name, `payload_json` | `created_by` |
| `schema_migrations` | filename, applied_at | none. `033` revokes this table from the tenant DB role |

`033_add_shelters.pg.sql` adds `shelters` (`id`, `name`, `slug`, `created_at`, later `logo` bytea and `logo_mime`), inserts Assisi (`id` 1, slug `assisi`), then adds `NOT NULL shelter_id` plus RLS policy `tenant_isolation` for role `shelterlink_tenant` on the per-shelter tables listed in that file (lines 43-87). The comment at lines 4-6 says the app role bypasses RLS unless it `SET LOCAL ROLE shelterlink_tenant`. I did not trace every query to confirm that switch always happens. `utils/shelterContext.js` is the place that would do it.

## 6. Deployment

Found:

- `Dockerfile`: Node 22 Alpine, `postgresql-client`, `npm ci --omit=dev`, non-root user `app`, port 3000, health check against `/healthz`.
- `.github/workflows/ci.yml`: on every push and pull request. Postgres 16 service. `npm test`. Tenant test URL is `postgresql://postgres:...@127.0.0.1:5432/shelterlink_tenant_test` (password is the CI service password `postgres`, not a production secret).
- `DEPLOY.md`: written as host-agnostic for Railway, Render, or similar, with Supabase Postgres (session pooler, port 5432). Tells the operator to cron `npm run backup`. Does not name the live project.
- `README.md` line 59 tells volunteers to open `https://shelterlink.online` on iPhone. That is the only production hostname I found in the README.
- `utils/serviceWorker.js` reads Render, Railway, and generic git commit env vars, in that order, to version the service worker. That shows the author expected one of those hosts. It does not prove which one is live.
- `docs/BACKUP-RESTORE.md` exists (not fully read). Backup script is `scripts/backup.js` (`npm run backup`), encrypted with `BACKUP_ENCRYPTION_KEY`.

Not found: `vercel.json`, `Procfile`, `railway.toml`, `render.yaml`, `fly.toml`, a `docker-compose` file.

Could not determine from the repo: which host is actually serving `shelterlink.online`, which Supabase project (or other Postgres) is production, whether backups run on a schedule, or where backup files are copied off the server. `DEPLOY.md` leaves that as operator steps.

## 7. Risks observed (not fixed)

1. **Schema and app disagree on a fresh install.** `schema.pg.sql` has no `shelters` table. Application login, register, and `bindShelter` require `shelter_id`. `migrate.js` claims the schema file is complete (`scripts/migrate.js` lines 8-9). It is not, for `033`.
2. **Registration enumerates accounts.** `POST /api/auth/register` returns 409 `Email already in use` (`controllers/authController.js` lines 54-57). Login and forgot-password do not.
3. **Login timing differs for known and unknown emails.** bcrypt runs only after a row is found (lines 93-101).
4. **Password policy is the older rule.** Minimum 8, uppercase, and a digit (`utils/password.js` lines 7-11). Breach check fails open: if the HIBP call throws, `passwordPolicyError` returns null (lines 21-25).
5. **Demo passwords in source.** `controllers/publicConfigController.js` lines 7-19 hardcode `Admin123!` and `Password1` for seed accounts. They are returned by `GET /api/public/config` and `GET /api/public/demo-info` whenever `NODE_ENV` is not `production`. `scripts/smoke-test.js` line 45 falls back to `Admin123!` on loopback. These match the documented seed, not a production secret, as long as production stays `NODE_ENV=production` and `db:setup` is run with `--no-seed` (`DEPLOY.md` lines 27-29).
6. **Staff email addresses in logs.** `controllers/messageController.js` line 90 logs `recipient.email` when a bulk send fails. `create-admin.js` line 36 prints an existing email. `scripts/clean-demo.js` line 98 prints user emails. Request handlers otherwise log `error.message`, not the password.
7. **SQL fragments are interpolated in a few models.** Values I checked are numbers clamped in JS, not raw strings: `models/AuditLog.js` lines 52-74 (`LIMIT`/`OFFSET`), `models/Opportunity.js` lines 438-485 (`safeLimit` clamped 1-200), `models/Tag.js` line 245 (clamped 1-50). `models/ShiftNote.js` line 131 interpolates a constant `TABLE = 'shift_notes'`. I did not read every query. A full sweep belongs in the SQL pass. `config/database.js` uses `?` placeholders and maps them to Postgres parameters (inferred from call sites; the adapter itself was not line-audited here).
8. **`GET /api/me/ical-feed` returns the calendar token** to the logged-in user (expected), and `GET /api/my-shifts.ics?token=` is a bearer token with no expiry column on `users.ical_token` (`schema.pg.sql` lines 84-86). Anyone with the token can read that user's upcoming shift titles and locations.
9. **Several ID routes are only "any logged-in user" at the router.** Examples: `GET /api/documents/:id/download`, `DELETE /api/documents/:id`, `GET /api/animals/:id`, `POST /api/animals/:id/activity`, `GET /api/transport/:id`, thread reads by `:id`. Whether the controller checks ownership was not verified. Do not treat the route table as an object-level access audit.
10. **`GET /api` is an unauthenticated banner** (`server.js` lines 212-214).
11. **CSP allows `'unsafe-inline'` styles** (`utils/csp.js` line 7). Scripts are `'self'` only. I did not inventory inline scripts.
12. **Rate limits are not env-configurable.** They are constants in `middleware/rateLimiter.js`.
13. **Working tree has duplicate files** such as `utils/emailConfig 2.js` (git status at the start of this pass showed them untracked). I did not open them. They are not part of the running `require` graph unless something imports the spaced name.

No `.env` file is tracked (it is gitignored). I did not search git history for old secrets. That is the next prompt, and this pass was not asked to rewrite history.

## 8. Not determined

- The live host, region, and whether Postgres is Supabase or something else.
- Whether `033_add_shelters.pg.sql` has been applied to the database behind `shelterlink.online`.
- Whether every controller enforces "this id belongs to this user" after the route-level auth check.
- Whether `runWithShelter` always sets the Postgres role that RLS applies to.
- Contents of `audit_log.detail_json` in real rows.
- A full inventory of string-built SQL. The hits above are the interpolation grep, not a complete query review.
