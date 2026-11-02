# What erasure changes

This is a reading of the code on 2 Nov 2026. It is not a view on whether the result meets GDPR, and it does not change the code.

Erasure runs `anonymiseUser` in `models/Gdpr.js`, then writes one audit row from `controllers/gdprController.js`. Only a volunteer account can be anonymised. A staff or admin account is refused. A second erase of the same account returns without changing it again.

The tables below are the ones in `database/schema.pg.sql`, plus columns added by the `*.pg.sql` migrations, plus the `session` table the session store creates. `database/schema.sql` is the old MySQL file. This list does not use it.

## What was checked

Read: `models/Gdpr.js` `anonymiseUser` (lines 133-265), `controllers/gdprController.js` `eraseVolunteer` (lines 77-121), `utils/sessionCookie.js` `destroyUserSessions` (lines 51-63), `models/UserDocument.js` (lines 17-21), `config/retention.js`, `scripts/backup.js` (the 14 day file age), `frontend/pages/privacy.html`, and the table definitions in `database/schema.pg.sql` and the Postgres migrations.

Not run for this note: `npm test`, `npm run test:local`, and `npm run backup`.

`test/gdprErasure.local.test.js` asserts only this, when that local test is run: the user's email, phone, first name, and last name; the profile address; that the new `gdpr.erase` audit detail does not contain the sample address, phone, or email; and that the `session` row for that user id is gone. It does not check documents, messages, references, or the other tables.

## Replaced or cleared on the user's own rows

`users`, lines 170-184. The row stays. `first_name`, `last_name`, and `name` become "Anonymised", "User", and "Anonymised User". `phone` becomes null. `email` becomes `deleted+<id>@anonymised.invalid`. `password` is replaced with a new hash the person does not know. `reset_token`, `reset_token_expires`, and `ical_token` become null. `anonymised_at` is set.

Left on `users`: `role`, `created_at`, `last_login`, `consent_given_at`, `privacy_notice_version`, and `shelter_id` (added in `database/033_add_shelters.pg.sql`). There is no statement for those columns.

`volunteer_profiles`, lines 186-204. The row stays. These become null: `date_of_birth`, `address`, `emergency_contact`, `skills`, `availability`, `home_type`, `has_garden`, `garden_secure`, `has_other_dogs`, `has_other_cats`, `has_children_under_16`, `can_medicate`, `max_foster_size`, `foster_notes`.

Left on `volunteer_profiles`: `approved`, `volunteer_type`, `required_hours`, `foster_approved`, `away_until`, `last_engagement_email_at`, `prefer_urgent`, `prefer_reminders`, `prefer_threads`, `prefer_fosters`, `created_at`. There is no statement for those columns.

`messages` written by this user, lines 212-215. The row stays. `body` becomes `[removed]`. `thread_id`, `created_at`, `deleted_at`, and `deleted_by` stay.

`background_checks` for this user, lines 216-221. The row stays. `reference_number` and `notes` become null. Left: `check_type`, `issued_on`, `expires_on`, `status`, `updated_by`, `updated_at`.

`shift_notes` this user authored, lines 222-225. The row stays. `body` becomes `[removed]`. `opportunity_id` and `created_at` stay.

`foster_offers` for this user, lines 226-229. The row stays. `note` becomes null. `request_id`, `status`, and `created_at` stay.

`group_bookings`, lines 230-237. Not matched by a user id. Matched where `contact_email` equals the email read before the account email is replaced. On those rows, `contact_name` becomes "Removed", `contact_email` becomes `removed@anonymised.invalid`, and `notes` becomes null. `group_name`, `size`, `status`, and `opportunity_id` stay. A booking that used a different email is left entirely.

`audit_log`, lines 238-244. Rows stay. `detail_json` becomes null where `user_id` is this person, or where `entity_type` is `volunteer` and `entity_id` is this person's id. `action`, `entity_type`, `entity_id`, `created_at`, and the other `user_id` stay. The new `gdpr.erase` row is written after this update (`controllers/gdprController.js` lines 97-106), so it is not cleared. Its detail is the user id, the preserved hours total, and whether the account was already anonymised.

## Deleted

These deletes are by this user's id. `models/Gdpr.js` lines 207-211.

- `custom_field_values`. The answer text goes with the row.
- `user_documents`. The row includes `content`, the file bytes. `models/UserDocument.js` lines 17-21 say the bytes live in Postgres, not in a file on disk. Deleting the row deletes those bytes. This code does not also delete a file from a folder.
- `volunteer_tags`. The link to a tag name goes. The shared `tags` row stays.
- `push_subscriptions`. `endpoint`, `p256dh`, `auth`, and `user_agent` go with the row.
- `volunteer_references`. Referee name, referee email, relationship, comments, and the token hash go with the row.

## Left, and still tied to this user id

`anonymiseUser` has no statement for these. The user id column stays, so the row can still be found from this account.

- `applications`. Includes `notes`, `rejection_reason`, status, and check-in times.
- `shift_feedback`. No user id of its own. `application_id` still points at an application with this user id, so `comment` and `rating` stay tied to the account.
- `swap_requests`. Tied through `application_id`, or `waitlist_offered_to_user_id`. `claim_token` stays.
- `volunteer_hours`. Line 158 says approved hours are left so totals still add up. The row keeps `user_id`, `date`, `hours`, and `approved`. There is no name column.
- `volunteer_qualifications`. Award date, expiry, and who awarded it stay.
- `opportunity_match_queue`.
- `tag_digest_log` and `message_digest_log`. A user id and a date or hour. No message body.
- `waiver_acceptances`. Which waiver version was accepted, and when.
- `animal_activity`. `notes` stay, with this `user_id`.
- `foster_placements`. `notes` stay, with this `user_id`.
- `foster_requests` this user created (`created_by`). `description` stays.
- `transport_runs` this user created, and `transport_legs` this user claimed. `notes` and locations stay.
- `incidents` this user reported (`reported_by`) or resolved. `body` stays.
- `message_threads` this user created. `subject` stays.
- `thread_participants` for this user.
- `certificates`. The code, the hours snapshot, and the shift count stay, with this `user_id`.
- `opportunity_templates` this user created. `payload_json` stays.
- `opportunities.created_by`, when it is this user. Title and description stay.
- `admin_messages.admin_id`, only if this user were the admin. Erasure refuses admin accounts, so a volunteer erase does not take this path. The `body` is not searched.

## Not this person's record

No statement in `anonymiseUser`. These are not a volunteer profile.

- `qualifications`, `opportunity_qualifications`, `tags`, `opportunity_tags`, `custom_fields`, `waivers`, `opportunity_animals`. Shared definitions or links between shifts and animals.
- `animals`. Name, notes, and handling notes are about an animal. They are not keyed to a volunteer. A note can still name a person. See the free-text section.
- `animal_photos`. Image bytes for an animal, not a user id. A photo can show a person. Erasure does not delete it. `animals.photo_filename` is only a marker that a photo exists.
- `shelters`. Shelter name, slug, and logo. The logo is not this volunteer's file.
- `job_runs`. Job name, time, status, and `detail`. Erasure does not read `detail`. A job could have written an address into that text. This note did not trace every job.
- `schema_migrations`. File names of applied migrations.

## Outside the rows

Uploaded documents. The bytes are the `content` column. They are deleted with the `user_documents` row. There is no second copy on disk in this code.

Animal photos. Left, as above.

Audit detail. Cleared on the rows named above. The audit row itself stays. Staff `user_id` on a row about this volunteer stays.

Email already sent. There is no table of sent mail. Erasure cannot recall a message that already went out through SMTP.

Backups. `scripts/backup.js` writes an encrypted dump of the database and deletes dump files older than 14 days. Erasure does not open or rewrite an old dump. A dump taken before the erase still has the old rows until that file ages out.

Sessions. After the database transaction commits, `destroyUserSessions` deletes from `session` where the stored JSON `userId` matches (`utils/sessionCookie.js` lines 57-60). That table is not in `schema.pg.sql`. If the delete throws, the error is logged and swallowed (lines 61-63). The erase still reports success.

## Text written by someone else

A row that only mentions this person in free text, and does not store their user id, is not found. Erasure does not search message bodies, notes, or comments for a name.

Left for that reason:

- `messages.body` written by someone else, even if it names this person.
- `shift_notes.body` written by someone else.
- `volunteer_references` for a different volunteer, including a comment that names this person. This person's own reference rows are deleted.
- `incidents.body` reported by someone else.
- `applications.notes` and `rejection_reason` are this person's application, so they are still tied by `user_id`. They are left because there is no statement for `applications`, not because the text cannot be found.
- `shift_feedback.comment` is still tied through `application_id`, and it is left.
- `animals.notes`, `animals.handling_notes`, `foster_requests.description`, `foster_placements.notes`, `transport_runs.notes`, `transport_legs.notes`, `admin_messages.body`, and `opportunities.description` can name a person and are not searched.

## Where this differs from the privacy notice

`frontend/pages/privacy.html` was not rewritten. Legal wording is for Ryan.

The notice says erasure replaces your name and contact details and keeps approved hours (line 91). The code does that, and it also changes the other rows in the sections above. The notice does not say that documents, references, push subscriptions, or custom answers are deleted, or that message and note text this person wrote becomes `[removed]`.

The notice says applications and approved hours are kept, and that a name can be removed from the account (line 86). That matches `applications` and `volunteer_hours` being left, and the name columns being replaced. It does not mention `applications.notes` or `rejection_reason`, which stay.

The notice says a record of staff views is kept (line 69), and that the audit log is not deleted on a schedule (line 87). Erasure does not delete audit rows. It does clear `detail_json` on rows for this volunteer. The notice does not say that.

The notice says inactive accounts are not removed on a schedule because a period has not been set (line 85). `config/retention.js` leaves each period null until an environment variable sets a positive number, and `runDataRetention` skips a null period. Setting the variable would start the same anonymise function on a schedule. The notice does not say that.

The notice says the password itself is not stored, and that a hash is (line 66). Erasure replaces that hash. It does not store the new password in clear text.

The notice says ShelterLink is the volunteer rota used by Assisi Animal Sanctuary (line 54). This list does not confirm that sentence.

## Decisions for Ryan

These are choices for you. This file does not make them.

- Should rows that stay tied to the user id be blanked as well: application notes and rejection reasons, feedback comments, animal-activity notes, foster placement notes, incident text this person reported, and transport notes on a leg they claimed?
- Free text that only contains a name, with no user id, cannot be found by erasure. Should that stay as it is?
- A background check keeps its type, dates, and status after the reference number and notes are cleared. Should the whole check row go?
- Profile flags that stay include approval, foster approval, `away_until`, and the notification preferences. Should those be cleared?
- A group booking keeps `group_name` when the contact email matches. Should that name be cleared too?
- Old backup files are not rewritten. They are deleted after 14 days by `scripts/backup.js`. Is that long enough to say the erased data is gone?
- Animal photos are not tied to a user and can show a person. Should erasure do anything with them?
- If the session delete fails, the error is logged and the erase still reports success. Should a failed session delete fail the erase?
- The privacy notice describes a smaller change than the code. The notice was not edited here.
