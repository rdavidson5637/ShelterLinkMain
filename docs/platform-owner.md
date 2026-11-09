# Platform owner: local and staging setup

The platform owner approves new shelters at `/platform/shelters`. Being a
platform owner is separate from `users.role`: a shelter admin is not a
platform owner unless their user id is in `platform_owners`.

Anyone who is not a platform owner gets the normal 404 page at
`/platform/shelters` and a 404 from every `/api/platform/*` route. The page
file cannot be opened directly at `/pages/platform-shelters.html`.

Do not run any of this against production. `scripts/platform-owner.js`
refuses when `NODE_ENV=production`, refuses a non-localhost `DATABASE_URL`
unless you pass `--staging`, and refuses Supabase unless
`CONFIRM_LIVE_SHELTER=yes` is also set.

## 1. Make yourself a platform owner

The user must already exist. Locally, `npm run db:reset` seeds an admin you
can use, or sign up through `/register` first.

```sh
# local
node scripts/platform-owner.js add --email you@example.com

# staging (DATABASE_URL set to the staging database)
node scripts/platform-owner.js add --email you@example.com --staging

node scripts/platform-owner.js list
node scripts/platform-owner.js remove --email you@example.com
```

Same thing in SQL, if you prefer:

```sql
INSERT INTO platform_owners (user_id)
SELECT user_id FROM users WHERE lower(email) = lower('you@example.com')
ON CONFLICT (user_id) DO NOTHING;
```

Sign in as that user and open `/platform/shelters`.

## Where applications come from

Charities apply at `/apply` (`POST /api/public/shelter-applications`). The
form asks for the shelter name, a web address (slug), the regulator, the
charity number, and a contact name and email.

- Only `ccni` and `ccew` are accepted for now. Scottish and Irish charities
  are told they cannot apply yet.
- The charity number is checked against the register's format and
  normalised (`nic 100123` becomes `NIC100123`). The register lookup
  result is saved in `register_snapshot` for you to read. It never
  approves anything, and an unavailable register does not block the
  application.
- A slug used by a shelter or a pending application, a reserved slug
  (`admin`, `platform`, `invite`, `join`, `demo`, `test`, `pages`,
  `healthz` and so on), a charity that already has a shelter, and a
  charity with a pending application are all refused. Once
  `database/040_shelter_applications_pending_unique.pg.sql` is applied
  (not yet applied anywhere), partial unique indexes enforce the
  pending-slug and pending-charity rules in the database too, so two
  submissions at the same moment cannot both get in.
- A form sent less than 3 seconds after the page loaded (or with no
  start time, or after 12 hours) is refused with a "take a moment" or
  "reload" message.
- At most `SHELTER_APPLY_MAX_PENDING` (default 100) pending applications
  in total, and `SHELTER_APPLY_MAX_PENDING_PER_EMAIL` (default 3) per
  contact email. Past that, new applications are turned away (503 / 429)
  until the queue is worked through.
- A hidden honeypot field catches simple bots: they get the normal
  "thanks" answer and nothing is stored. `RATE_LIMIT_SHELTER_APPLY`
  (default 5 per window) limits each connection.
- No email is sent when an application arrives. Check the queue at
  `/platform/shelters`.

## 2. Getting an invite link on staging (until PR6)

Approving an application creates the shelter and an admin invite, but the
raw invite token is never returned to the browser and only its SHA-256 hash
is stored. So the token from the approval cannot be read back, from the API
or from the database.

Until PR6 sends invite emails, issue a fresh one from the command line:

```sh
node scripts/platform-owner.js staging-invite --slug north-paws --staging
```

This finds the approved application for that slug, expires any older unused
invites for the applicant's email, creates a new 7-day admin invite, writes an
`invite.created` row to `platform_audit`, and prints the raw token once.
There is no accept page until PR6, so keep the token to test that page with.
Do not paste tokens into tickets or chat.
