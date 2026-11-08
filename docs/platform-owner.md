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
| `/s/<slug>`, `/s/<slug>/opportunities`, `/s/<slug>/group-booking`, `/join/<slug>` | Normal 404 page |
| `?shelter=<slug>` on public APIs (board, ICS feed, brand, group booking, sign-up) | 404. A suspended slug never falls back to Assisi, so an ICS subscriber or embedded board does not start showing another shelter's shifts |
| Invite links (PR6) | Not valid, and accepting is refused |
| Scheduled jobs | Reminders, digests, expiry notices and feedback requests skip the shelter. Data retention and expired-token cleanup keep running |

Slug and status lookups are cached for 30 seconds per server instance. The
instance that handles the suspend clears its cache at once; any other
instance catches up within 30 seconds.

An unknown slug on a public API still falls back to Assisi, as before. Only
the page routes (`/s/<slug>`, `/join/<slug>`) 404 for an unknown slug.

**Reactivate** on a suspended shelter (`POST
/api/platform/shelters/:id/reactivate`) sets it back to `active`, writes a
`shelter.reactivated` row with the optional reason, and clears this
instance's cache. Its people can sign in again, its pages and feeds come
back, and jobs pick it up on their next run. Sessions ended by the
suspension stay ended, so people sign in again. Needs migration
`039_platform_audit_reactivate.pg.sql` (`npm run migrate`).
