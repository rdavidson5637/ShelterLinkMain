# SQL and input validation

Read `docs/audit/00-recon.md` first. This pass parameterises the queries that interpolated values, and adds one server-side validator (`zod`) for write bodies. Schema and auth rules are unchanged.

## SQL

Values go through `pool.execute`, which turns `?` into Postgres parameters (`config/database.js`). Dynamic `SET` and `INSERT` column lists are built from allow-lists in code, not from request keys copied straight into the SQL.

| Location | What was interpolated | Status |
|---|---|---|
| `models/AuditLog.js` `findAll` | `LIMIT` / `OFFSET` after a JS clamp | Now `LIMIT ? OFFSET ?` |
| `models/Opportunity.js` `resolveUrgentCoverRecipients` | `LIMIT` after a clamp of 1-200 | Now `LIMIT ?` |
| `models/Tag.js` recommendations | score weights (constants) and `LIMIT` 1-50 | Weights and limit are parameters |
| `models/AdminMessage.js` `findAll` | `LIMIT` 1-200 | Now `LIMIT ?` |
| `models/MessageThread.js` `getMessages` | `LIMIT` 1-500 | Now `LIMIT ?` |
| `models/Tag.js`, `models/DaySheet.js`, `models/Animal.js`, `models/Qualification.js`, `models/ShiftNote.js`, `utils/pushService.js`, `scripts/clean-demo.js` | `IN (${placeholders})` | Already one `?` per bound id. Not user text. |
| `models/Opportunity.js`, `models/Animal.js`, `models/VolunteerProfile.js`, `models/Foster.js`, `models/Qualification.js`, `models/CustomField.js`, `models/UserDocument.js` | `SET ${assignments}` / column lists | Column names come from allow-lists (`ALLOWED_UPDATE_FIELDS`, `ALLOWED_PROFILE_FIELDS`, and explicit `if` branches). Request keys that are not on the list are dropped. |
| `models/Application.js`, `models/ShiftFeedback.js`, `models/Incident.js`, `models/Foster.js` | `WHERE` fragments | Fragments are fixed strings. Filter values are `?` parameters. |
| `models/ShiftNote.js` and other models | `${TABLE}` | A constant in the same file, not request data. |
| `models/Gdpr.js` session delete | `%"userId":${id}%` | This is a bound parameter value, not SQL text. The id is the route id. |

No `ORDER BY` column is taken from the request. Sort columns in the models are fixed in the SQL.

## Validation

`zod` is the validation library. It was not in the project before this pass (`validator` is still used by `middleware/sanitize.js` for email shape and XSS cleaning, which runs first).

- `middleware/validate.js` checks write bodies with `.strict()`, so a field that is not in the schema returns `400` `{ error: 'Invalid request data.', fields: { field: message } }`. No stack is included.
- The same shape is used for a bad numeric `:id`, `:userId`, `:noteId`, `:legId`, `:messageId`, `:applicationId`, or `:offerId`, and for a token or certificate code that is empty or too long.
- Query strings on list and filter routes use a strict schema of the keys that route already reads. Unknown query keys on those routes are rejected. Every `/api` query key must be a plain name, and each value is capped at 2000 characters.
- Existing controller messages are unchanged when the body is the shape the form already sends. A missing password still gets the controller's own message. An extra field such as `role` is rejected before the controller runs.
- Response shape: successful responses are unchanged. Validation failures add a `fields` object next to `error`. Screens that only read `error` show "Invalid request data."

## HTML in the browser

User-supplied text that was inserted with `innerHTML` now goes through `frontend/js/utils/escapeHtml.js` in:

- `frontend/js/admin/volunteers.js` (profile, qualifications, waivers, documents, custom answers, status text)
- `frontend/js/admin/opportunities.js` (status text, shift notes, check-in print view)
- `frontend/js/admin/fosters.js` (status text, offer name and note)
- `frontend/js/volunteer/dashboard.js` (checklist, badges, helped animals, check-in code, qualifications, documents)
- `frontend/js/volunteer/certificate.js` (status text, badge labels)
- `frontend/js/volunteer/foster.js` (status text, animal name, description, placement)
- `frontend/js/volunteer/my-applications.js` (status text)

Shift notes on My applications already use `textContent`. Threads already use `escapeHtml`.

## Uploads

Two upload paths, both memory storage then Postgres, not disk:

- Volunteer documents (`controllers/documentController.js`): PDF, JPG, PNG only, 5MB, magic-byte check, disclosure-looking names refused, stored name is random. The original name kept for download is now a basename with a short safe character set.
- Animal photos (`controllers/animalController.js`): JPG or PNG, 5MB, magic-byte check, stored name is random. The browser filename is not used as the stored name.

## What did not change

- Table shapes, roles, and session cookies.
- Login, forgot-password, and register response text when the body is valid for those routes.
- Email HTML is not part of the vanilla pages. Bulk messages already escape the body in `controllers/messageController.js`. Other mail templates were left as they are.
