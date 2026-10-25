# ShelterLink - what's left, in order

Direction: production platform for Assisi. See `DEPLOY.md` and `ASSISI-DEMO.md`.

Product surface for the shelter call is complete. `npm test` — **424** green (PWA, push, CSP, dates, tenant isolation).
Live prove-out still needs your `DATABASE_URL`.

## 1. Point the app at Postgres (you) — blocking for demo

1. Supabase session pooler **5432** → `DATABASE_URL` in `.env`
2. Optional: `SHELTER_EMERGENCY_PHONE`, Brevo `EMAIL_*`, VAPID keys
3. `npm run db:reset` → `npm run dev` → `npm run smoke`
4. Walk `ASSISI-DEMO.md` (login shows demo accounts when not production)

## 2. Shipped for Assisi

Scheduling, animals, day/week sheets, messaging, fosters, transport relays,
urgent cover + push, shift notes, templates, away mode, certificates,
AccessNI + references, onboarding pipeline, incident/welfare notes (staff),
PWA (root service worker, install prompt, offline shifts, push on dashboard), privacy notice, staff morning guide.

## 3. After the call (only if they ask)

- SMS urgent cover (paid)
- Deeper analytics / delivery stats
- Tweaks from coordinator feedback

## 4. Go-live (you)

`npm run check-prod` lists missing names only. Then, on the host: HTTPS `APP_URL`,
session secret, admin key, session-pooler `DATABASE_URL` (`postgres.<project-ref>`, port 5432),
Brevo SMTP, backup key, and `CONFIRM_LIVE_SHELTER=yes ADMIN_INITIAL_PASSWORD='...' npm run create-admin`.
That admin is attached to the only shelter. Leave `DATA_RETENTION_YEARS` blank until Assisi sets it. Fresh database:
`node scripts/setup-db.js --no-seed` (add `--force` only for that first empty build).
Existing database: `npm run migrate`, and `BACKUP_CONFIRMED=yes` only after an encrypted backup
if `034_` is still pending. One restore drill is still not done (`docs/BACKUP-RESTORE.md`).
Article 10 still needs a DPIA and a written controller/processor arrangement (`docs/VETTING-DATA.md`).
Privacy notice gaps stay marked until Assisi fills them. Do not invent those sentences.
