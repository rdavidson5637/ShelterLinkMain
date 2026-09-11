# ShelterLink round 4 - Cursor prompts

Closes the seven gaps in `shelterlink-market-brief-2026.md`. These are the features that turn ShelterLink from a scheduling app with a shelter's name on it into a shelter product.

**Run R1 first.** Animals are the foundation: fostering, transport and walk records all reference them. Everything after R1 can be done in any order, though R4 (messaging) is what actually kills the WhatsApp group so do not leave it to last.

**Conventions** (unchanged): Express + MySQL, routes/controllers/models, numbered migrations in `database/` folded into `schema.sql`, `node --test` with `test/helpers/mockDb.js`, vanilla JS ES modules, PicoCSS plus `custom.css` design tokens, no build step. Migration numbering continues from wherever your last applied migration sits. If you have run the Supabase port, tell Cursor to write Postgres SQL and `.pg.sql` migrations instead.

---

## R1 - Animals as first-class records

The differentiator. Without this ShelterLink is a generic scheduler.

```
Add animals to this Express/MySQL shelter volunteer app. Today every shift is animal-agnostic, which means a dog-walking shift does not know which dogs are walked and a volunteer never sees the animals they helped.

1. Migration: table animals (id, name, species enum('dog','cat','small_animal','other'), breed, sex, date_of_birth date null, arrival_date date, status enum('available','reserved','adopted','foster','medical','not_for_rehoming') default 'available', kennel_ref varchar, photo_filename, notes text, handling_notes text, requires_qualification_id FK null, created_at, updated_at). Junction opportunity_animals (opportunity_id, animal_id). Table animal_activity (id, animal_id, user_id, application_id null, activity_type enum('walk','feed','socialise','clean','medical','transport','other'), notes text, logged_at). Fold into schema.sql.
2. Admin CRUD at /pages/admin/animals.html: list with species and status filters, photo upload reusing the existing document upload middleware (5MB, jpg/png only, stored outside web root, served through an authed route), and per-animal detail showing linked shifts and recent activity.
3. Opportunity create and edit: multi-select "Animals on this shift". Show the selected animals with photo, name and handling notes on the shift detail and in the volunteer opportunity modal.
4. handling_notes is the safety-critical field ("pulls left", "muzzle required", "no other dogs"). Show it prominently to any volunteer with an accepted application, and on the printable day sheet.
5. If an animal has requires_qualification_id set, applying to a shift that includes that animal is gated exactly like the existing opportunity-level qualification gating, with a clear message naming the animal and the qualification.
6. Volunteers log activity against an animal from their accepted shift: quick buttons for walk/feed/socialise plus an optional note. Show "Animals you have helped" on the volunteer impact profile with counts.
7. Admin animal detail shows a full activity timeline: who, what, when. This is the record a shelter actually needs for welfare audits.
8. Tests: qualification gating via animal, activity logging requires an accepted application on a shift including that animal, photo upload rejects wrong mime, animal status transitions.

Keep every existing shift flow working for shifts with no animals attached.
```

---

## R2 - Foster placements

```
Add foster placements to this Express/MySQL shelter volunteer app. Fostering is the highest-value volunteer activity at a shelter and it does not fit the shift model: it is an open-ended placement of one animal with one volunteer, not a time-boxed slot.

1. Migration: add to volunteer_profiles the home-suitability fields foster_approved tinyint default 0, home_type enum('house','flat','other') null, has_garden tinyint null, garden_secure tinyint null, has_other_dogs tinyint null, has_other_cats tinyint null, has_children_under_16 tinyint null, can_medicate tinyint null, max_foster_size enum('small','medium','large') null, foster_notes text.
   Table foster_requests (id, animal_id FK, created_by FK users, urgency enum('planned','urgent') default 'planned', needed_from date, expected_duration_days int null, requirements_json, description text, status enum('open','matched','cancelled') default 'open', created_at).
   Table foster_placements (id, animal_id FK, user_id FK, request_id FK null, started_on date, expected_end_on date null, ended_on date null, status enum('active','ended','returned_early') default 'active', notes text). Fold into schema.sql.
2. Admin posts a foster request with the animal, urgency, requirements (from the home-suitability fields) and a description. Matching volunteers are those with foster_approved = 1 whose profile satisfies every stated requirement.
3. Volunteers see foster requests they match on a new "Foster" page and can offer to foster. They never see requests they do not match, and never see who else offered.
4. Admin reviews offers and confirms one, which creates a foster_placement, sets the animal status to 'foster', and emails the volunteer with the animal's handling notes and vet details.
5. Active placements: admin list showing animal, foster carer, start date, days elapsed and expected end. Ending a placement sets ended_on, returns the animal status to 'available' (or a status the admin picks) and prompts for an outcome note.
6. Foster carers see their active placements on their dashboard with a "log a check-in" action writing to animal_activity, and the shelter's emergency contact number always visible.
7. Foster hours: count placement days toward the volunteer's contribution record separately from shift hours, and include them in exports as a distinct column. Do not silently mix the two.
8. Tests: requirement matching including the negative cases (has_other_cats blocks a cat-only-home request), only foster_approved profiles match, confirming a placement is atomic with the animal status change, ending a placement restores availability.
```

---

## R3 - Transport runs with claimable legs

```
Add animal transport runs to this Express/MySQL shelter volunteer app. Rescue transport is usually a relay: several drivers each cover one leg. This is a standard workflow with no equivalent in the app today.

1. Migration: table transport_runs (id, animal_id FK null, title, run_date date, notes text, status enum('open','part_covered','covered','completed','cancelled') default 'open', created_by FK users, created_at).
   Table transport_legs (id, run_id FK, leg_order int, from_location, to_location, depart_at datetime, arrive_by datetime, distance_miles decimal null, claimed_by FK users null, claimed_at datetime null, completed_at datetime null, notes text). Fold into schema.sql.
2. Admin creates a run with an ordered set of legs. Run status derives from leg claims: open (none claimed), part_covered, covered (all claimed), completed (all legs completed).
3. Approved volunteers with a driving-related tag or qualification see open legs on the Transport page and claim individual legs. Claiming is transactional so two drivers cannot take the same leg.
4. A claimed leg shows the driver the previous and next leg's contact arrangement through the shelter, never another volunteer's phone number directly. Handover coordination happens through the shift thread from R4 if present, otherwise through the shelter office number.
5. Drivers mark a leg complete, optionally recording actual mileage, which writes an animal_activity row of type 'transport'.
6. Mileage: total the run's distance per driver and expose it in exports so the shelter can reimburse expenses. Add an expense_claimed tinyint on the leg so finance can mark claims settled.
7. Admin view: a run timeline showing each leg, who has it, and gaps still needing a driver, with a "chase for cover" action reusing the urgent broadcast from R5.
8. Tests: leg claim is atomic under concurrent claims, run status derivation across all transitions, unqualified volunteer cannot claim, mileage totals per driver.
```

---

## R4 - Threaded messaging with admin oversight

This is the feature that replaces the WhatsApp group.

```
Add threaded messaging to this Express/MySQL shelter volunteer app. Today communication is one-way admin bulk email, which is why shelters keep a WhatsApp group running alongside any system.

1. Migration: table message_threads (id, subject, context_type enum('opportunity','foster_placement','transport_run','direct','announcement'), context_id int null, created_by FK users, created_at, closed_at null).
   Table thread_participants (thread_id, user_id, last_read_at datetime null, muted tinyint default 0).
   Table messages (id, thread_id FK, user_id FK, body text, created_at, deleted_at null, deleted_by FK null). Fold into schema.sql.
2. Every opportunity, foster placement and transport run gets a thread created lazily on first message. Participants are the accepted volunteers plus all staff and admins.
3. Privacy is non-negotiable and must be enforced server-side: a volunteer sees other participants' display names only, never email, phone or address. Assert this in tests. The API must never serialise contact fields into any messaging response.
4. Admin oversight: staff and admin can read every thread, and can soft-delete any message (deleted_at, deleted_by, body replaced with a tombstone in the UI). Volunteers can delete only their own messages, within 15 minutes.
5. Unread counts in the nav for both roles, driven by last_read_at. Mark read on thread open.
6. Notification policy: an unread message older than 15 minutes triggers one email digest per user per hour at most, via the existing scheduler and email service. Muting a thread suppresses this. Do not email a user about their own message.
7. Announcements: admin-created threads with context_type 'announcement' where only staff can post and volunteers can read. Replaces the one-way blast for shelter news.
8. Rate-limit posting, sanitise message bodies with the existing xss middleware, and cap body length at 2000 characters.
9. Tests: contact details never appear in any messaging payload for a volunteer session, participant resolution per context type, soft delete rules per role, digest de-duplication, unread counting.
```

---

## R5 - Targeted urgent requests and web push

```
Add urgency to this Express/MySQL shelter volunteer app. "We need cover at 7am tomorrow" and "this cat needs an emergency foster tonight" currently have no channel faster than email.

1. Web push: add a service worker push handler and a VAPID key pair in env (WEB_PUSH_PUBLIC_KEY, WEB_PUSH_PRIVATE_KEY, WEB_PUSH_SUBJECT). Migration: table push_subscriptions (id, user_id FK, endpoint text, p256dh, auth, user_agent, created_at, last_seen_at, unique on endpoint). Use the web-push npm package.
2. Volunteers opt in from their profile with a clear explanation of what they will receive. Store the subscription; prune subscriptions that return 404 or 410 on send.
3. Notification preferences per volunteer: urgent shift cover, foster requests they match, transport legs, thread replies, shift reminders. Default urgent and reminders on, the rest off. Respect away mode if the retention work is in.
4. Urgent broadcast: admin flags an opportunity, foster request or transport run as urgent. The app resolves the eligible audience only (qualified, approved, not already committed, matching foster criteria where relevant), then sends push to subscribers and email to the rest. Cap at 200 recipients, log to admin_messages, and block re-broadcasting the same item within 12 hours.
5. Every push links straight to the item and includes enough context in the body to act without opening the app.
6. Admin sees delivery counts: pushed, emailed, opened where available, and how many claimed the shift afterwards.
7. Graceful degradation: if VAPID keys are absent the app runs normally with email only and the UI hides push controls. Never crash on a missing key.
8. Tests: audience resolution excludes the unqualified and the already-committed, 12-hour re-broadcast guard, expired subscription pruning, preference filtering, missing-key fallback.
```

---

## R6 - References and AccessNI checks

The UK compliance layer. Volunteero's main differentiator, and neither Zelos nor the US platforms do it.

```
Add reference collection and AccessNI check tracking to this Express/MySQL shelter volunteer app. Northern Ireland shelters need vetting evidence for roles involving under-18s, vulnerable adults, or lone working, and the current qualifications table cannot model it.

1. Migration: table volunteer_references (id, user_id FK, referee_name, referee_email, referee_relationship, requested_at, token_hash, expires_at, responded_at null, is_suitable tinyint null, comments text null, status enum('requested','received','declined','expired') default 'requested').
   Table background_checks (id, user_id FK, check_type enum('accessni_basic','accessni_standard','accessni_enhanced','other'), reference_number varchar null, issued_on date null, expires_on date null, status enum('not_required','requested','pending','clear','flagged','expired') default 'not_required', notes text, updated_by FK users, updated_at). Fold into schema.sql.
2. References: admin requests two references on a volunteer's record. The system emails each referee a signed tokenised link to a public form (no account needed) asking relationship, suitability and free-text comments. Store the response, mark received, notify the coordinator. Tokens expire after 21 days and can be re-sent.
3. Referee responses are visible to staff and admin only and never to the volunteer. Say so on the form so referees answer honestly.
4. AccessNI: staff record check type, reference number, issue date and expiry, with status. Never store the certificate itself or any disclosure detail, only the reference and outcome. Add a note in the UI making that policy explicit, since storing disclosure content is a data protection risk.
5. Role gating: an opportunity can require a clear background check of a given level. Applying without one is blocked with a clear message, using the same pattern as qualification gating.
6. Expiry job on the existing scheduler: warn staff 60 days before a check expires and mark it expired on the day, mirroring the qualification expiry job.
7. Volunteer onboarding checklist on their dashboard: profile complete, waiver accepted, references received, check clear, induction qualification awarded. Show what is outstanding and what is waiting on the shelter, so volunteers stop emailing to ask.
8. Admin pipeline view: applicants grouped by onboarding stage so a coordinator can see who is stuck.
9. Tests: token validation and expiry, reference visibility excluded from every volunteer-facing payload, gating on missing and expired checks, expiry job selects each check once.
```

---

## R7 - Templates, weekly digest, and a contact privacy audit

```
Three smaller pieces that close the remaining competitive gaps in this Express/MySQL shelter volunteer app.

1. Shift templates. Migration: table opportunity_templates (id, name, payload_json, created_by, created_at). Staff save any opportunity as a template and create new shifts from one in two clicks. Templates carry title, description, location, times, capacity, tags, required qualifications, cutoff and linked animals, but never dates or check-in codes. Seed three templates matching the shelter's routine: morning dog walking, cattery care, kennel deep-clean.
2. Weekly digest. A Monday 07:00 job on the existing scheduler emailing each approved, non-away volunteer: their shifts this week, open shifts matching their tags, any foster requests they match, and unread thread count. One email per volunteer per week, recorded in job_runs, skipped entirely if they have nothing in any section. Include a one-click link to their calendar feed.
3. Contact privacy audit. Grep every API response shape and every rendered template for volunteer email, phone, address and emergency contact. Volunteers must never receive another volunteer's contact details in any payload, including messaging, group bookings, swap requests, transport legs, and the calendar feed. Staff and admin retain access. Fix anything that leaks, add a regression test per endpoint that returns volunteer-shaped data, and document the guarantee in docs/SECURITY.md so it can be stated publicly the way competitors do.
4. Tests: template round-trip excludes dates and codes, digest skips empty and de-duplicates per week, and the privacy regression suite.
```

---

## What this adds up to

After R1 to R7, ShelterLink does everything the paid mid-market does for a single shelter, plus four things none of the free tools do: animals as records, foster placements, transport relays, and UK vetting workflow. The claim becomes specific and true: **the free, self-hosted volunteer system built for animal shelters, with the animals in it.**

Still deliberately out of scope: native mobile apps (the PWA in round-3 prompt 24 covers it), SMS (needs paid Twilio), donor CRM, and multi-tenant hosting. None of those are needed for Assisi.
