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

## 2. Invite emails and the accept page

Approving an application creates the shelter and a 7-day, single-use admin
invite for the applicant's email. Once the transaction commits, the invite is
emailed with a link to `<APP_URL>/invite#<token>`. The token is in the
`#fragment`, which browsers never send to a server, so it never appears in
access logs, proxies or Referer headers. The raw token is never returned to
the owner's browser, never logged, and only its SHA-256 hash is stored.

A failed email does not undo the approval. The approve response carries
`inviteEmail: { sent, reason }` and the page says what happened:

| reason | meaning |
|---|---|
| `email_not_configured` | `EMAIL_HOST` and `EMAIL_FROM`/`EMAIL_USER` are not set |
| `app_url_missing` | production without an https `APP_URL`, so no safe link |
| `send_failed` | the SMTP server refused the message |

**Resend invite** on an approved application (`POST
/api/platform/applications/:id/resend-invite`) expires the unused invite,
issues a new one, writes an `invite.created` row with `source: resend`, and
emails it. It refuses before changing anything when email cannot be sent, and
refuses once the invite has been accepted. The queue hides the Resend
button and shows "Invite accepted" once it has been.

If the applicant's email already has a ShelterLink account (at any
shelter), the queue says so next to the application and the Approve
confirmation warns that accepting the invite will fail for that address.
The owner can still approve, then sort it out with the applicant. The
queue only learns yes or no for that email; it reads nothing else from
`users`.

### Accepting

`/invite#<token>` reads the token from the fragment, removes it from the
address bar, checks it (`POST /api/auth/invite/check` with `{ token }`) and shows the
shelter name and the invited email, read only. The applicant enters their
name, an optional phone number, a password, and confirms the privacy notice.
`POST /api/auth/accept-invite` then, in one transaction:

1. marks the invite used (one `UPDATE`, so the link works once even if two
   requests race)
2. refuses a suspended shelter
3. refuses an email that already has an account (the invite stays unused)
4. creates the user on the invite's shelter with the invite's role, and
   records privacy-notice consent
5. writes `invite.accepted` to that shelter's `audit_log`

The shelter, email, and role all come from the invite row. The request never
names them. The page then sends the new admin to sign in.

The page is served with `Referrer-Policy: no-referrer` and `Cache-Control:
no-store`, and the service worker does not cache `/invite`, as extra cover.

Rate limits are separate so that loading or checking a link never uses up
the attempts for creating the account (per IP, per `RATE_LIMIT_WINDOW_MS`):

| What | Env var | Default |
|---|---|---|
| `GET /invite` page | `RATE_LIMIT_INVITE_PAGE` | 60 |
| `POST /api/auth/invite/check` | `RATE_LIMIT_INVITE_CHECK` | 30 |
| `POST /api/auth/accept-invite` | `RATE_LIMIT_INVITE` | 8 |

### Staging without email

Where email is not set up, issue a fresh link from the command line:

```sh
node scripts/platform-owner.js staging-invite --slug north-paws --staging
```

This finds the approved application for that slug, expires any older unused
invites for the applicant's email, creates a new 7-day admin invite, writes an
`invite.created` row to `platform_audit`, and prints the raw token once. Open
`<APP_URL>/invite#<token>` to accept it. Do not paste tokens into tickets or
chat.

## 3. Suspending a shelter

**Suspend** on `/platform/shelters` (`POST /api/platform/shelters/:id/suspend`)
sets `shelters.status` to `suspended` and writes a `shelter.suspended` row to
`platform_audit`, with the optional reason. Nothing is deleted. You cannot
suspend the shelter your own account belongs to.

From then on:

| What | Behaviour |
|---|---|
| Signed-in staff and volunteers | Signed out on their next request: 403 `shelter_suspended`, session destroyed, cookie cleared |
| Sign-in | The right password gets 403 `shelter_suspended` and no session. A wrong password still gets the usual 401, so it never reveals the status |
| Forgot password | The usual generic 200, but no reset email is sent and no token is issued |
| A platform owner whose own account is in the suspended shelter | Can still sign in and reset their password, and keeps `/platform` and `/api/platform/*` (plus `/api/auth/me` and logout). The shelter's own API answers 403 `shelter_suspended` without signing them out |
| `/s/<slug>`, `/s/<slug>/opportunities`, `/s/<slug>/group-booking`, `/join/<slug>` | Normal 404 page |
| `?shelter=<slug>` on public APIs (board, ICS feed, brand, group booking, sign-up) | 404. A suspended slug never falls back to Assisi, so an ICS subscriber or embedded board does not start showing another shelter's shifts |
| Invite links (PR6) | Not valid, and accepting is refused |
| Scheduled jobs | Reminders, digests, expiry notices and feedback requests skip the shelter. Data retention and expired-token cleanup keep running |

Slug and status lookups are cached for 30 seconds per server instance. The
instance that handles the suspend clears its cache at once; any other
instance catches up within 30 seconds.

An unknown slug on a public API is also a 404 now, the same as the page
routes (`/s/<slug>`, `/join/<slug>`). Only a request with no slug at all
falls back to the signed-in shelter, then Assisi.

**Reactivate** on a suspended shelter (`POST
/api/platform/shelters/:id/reactivate`) sets it back to `active`, writes a
`shelter.reactivated` row with the optional reason, and clears this
instance's cache. Its people can sign in again, its pages and feeds come
back, and jobs pick it up on their next run. Sessions ended by the
suspension stay ended, so people sign in again. Needs migration
`039_platform_audit_reactivate.pg.sql` (`npm run migrate`).
