# Auth and roles

Read-only. No code was changed. Findings below were traced in the controllers and route files. They were not replayed against the live database.

Roles are `volunteer`, `staff`, and `admin` (`database/schema.pg.sql` check constraint). `requireStaff` is staff or admin. `requireRole('admin')` is admin only. `isAuthenticated` reloads the role from the database on the request (`middleware/auth.js` lines 3-12), so a role change applies on the next request. Login regenerates the session. Logout destroys the current session row.

Kiosk mode is a session flag, not a role.

## What each role can do

| Role | Enforced on the server |
|---|---|
| Public | Register, login, forgot/reset password, group booking, public board, feedback token, kiosk unlock/lock, certificate check, reference form |
| Volunteer | Own profile, own applications, own hours, own documents, shifts they are allowed to see, own foster placements |
| Staff | Most operational writes except profile approval, GDPR export/erase, role change, waiver and qualification definitions, volunteer document admin |
| Admin | Those staff exceptions, plus the routes marked `requireRole('admin')` |

Buttons in the HTML do not grant access. The checks above are in `routes/*.js` and the controllers.

## Checked and not a finding

- An unapproved volunteer cannot apply. `controllers/applicationController.js` lines 88-95 returns 403.
- A volunteer cannot cancel another volunteer's application. `cancelApplication` lines 363-365.
- Hours can be logged only for the session user, and only for an accepted or approved application of theirs. `controllers/hoursController.js` lines 46-57. The body has no user id.
- Profile create and update use `req.session.userId`. Role, approval, and shelter id are not profile fields. Prompt 5 also rejects unknown body fields.
- Document download and delete allow the owner or an admin. `controllers/documentController.js` lines 187-189 and 220-222.
- Foster check-in allows only the volunteer on that placement. `controllers/fosterController.js` lines 273-275.
- A volunteer can open a thread only as a participant. Staff can open any thread. `controllers/threadController.js` lines 33-38.
- Export of all hours and volunteers is admin-only at the route.
- Volunteer export of own hours forces the session user id. `controllers/exportController.js` lines 168-173.

## Findings

### F1. High. Erasure leaves personal data and does not end the login

File: `models/Gdpr.js` lines 146-186.

Reproduction: as an admin, `POST /api/admin/gdpr/volunteers/<id>/erase` with `{ "confirmation": "DELETE" }`. The account email becomes `deleted+<id>@anonymised.invalid`, and date of birth, address, and emergency contact are cleared. The same update does not clear foster home fields (`foster_notes`, children-under-16, garden, other pets). The session delete targets a table named `sessions` and a column named `data`. The live store is `session.sess` (`utils/sessionCookie.js` lines 53-55), and the error is swallowed, so the volunteer stays logged in. Push subscriptions, referee rows, and message text are not removed.

Suggested fix: clear the remaining profile columns, call `destroyUserSessions`, and delete or blank the related rows that still hold that person's words or contact details. Keep approved hour rows, which the current code does on purpose. No new column is required.

### F2. High. Staff can read sensitive profile fields with no audit row

File: `controllers/profileController.js` `getVolunteerProfile` lines 297-314, and `getAllVolunteers` lines 201-239.

The privacy notice says staff views of sensitive records are audited (`frontend/pages/privacy.html` line 50). `GET /api/admin/volunteers/:userId` returns date of birth, address, emergency contact, and phone. `GET /api/admin/volunteers` returns every volunteer's phone. Neither call writes `audit_log`. Day sheet and week sheet views do write one.

Reproduction: log in as staff and open a volunteer's profile. `audit_log` has no row for that view.

Suggested fix: `recordAudit` on the profile read, and one row when the volunteer list is loaded, with the viewer id and the record id. Do not put the address or phone in the audit detail.

### F3. Medium. Any logged-in user can fetch any animal photo

File: `controllers/animalController.js` `getPhoto` lines 196-205. Route: `GET /api/animals/:id/photo` in `routes/animals.js`.

Reproduction: log in as a volunteer and request `/api/animals/1/photo`. The handler checks only that a session exists.

Suggested fix: allow staff, or a volunteer who is accepted on a shift that includes that animal, or the current foster carer. Otherwise 404.

### F4. Medium. Any logged-in user can read an animal's kennel reference

File: `controllers/animalController.js` `getAnimal` lines 97-126.

A volunteer who is not on a shift still receives `toPublicAnimal`, which includes `kennel_ref`, status, breed, and sex. Handling notes are withheld unless they have an accepted shift with that animal. The list route is staff-only, so this is by guessing the id.

Suggested fix: return 404 for a volunteer with no shift and no foster placement for that animal. Keep the handling-note rule for people who do have one.

### F5. Medium. A pending applicant can read shift notes

File: `controllers/shiftNoteController.js` lines 35-40.

Reproduction: apply for a shift (status `pending` or `waitlisted`) and `GET /api/opportunities/<id>/notes`. The note body is returned.

Suggested fix: allow notes for `accepted` and `approved` only, plus staff.

### F6. Low. Registration says when an email is already used

File: `controllers/authController.js` lines 54-57. Login and forgot-password do not do this. `POST /api/auth/register` with an existing email returns 409 `Email already in use`.

Suggested fix: use the same response as a new registration, and do not create a second account. This can be done without a schema change.

### F7. Low. The calendar feed token does not expire

File: `controllers/publicController.js` `myShiftsIcs` around lines 231-244, and `GET /api/me/ical-feed`.

Anyone with the token can read that volunteer's shift list. The token is not rotated on password change except by erasure, which clears `ical_token`.

Suggested fix: rotate it when the password changes, and do not return the raw token from a page that other people can see. Optional expiry needs a column, so that part is "needs migration" if you want a timed token.

## Needs migration

None of F1-F6 need a new column. A timed calendar token would.

## Not tested against the live database

Object checks above are from the controller branches. A second person should repeat F1 and F2 on a scratch database before the fixes are treated as confirmed in production data.
