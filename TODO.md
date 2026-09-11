# ShelterLink - what's left, in order

Direction: production platform for Assisi. See `DEPLOY.md` and `ASSISI-DEMO.md`.

Product surface for the shelter call is complete. `npm test` — **242** green.
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
PWA, privacy notice, staff morning guide.

## 3. After the call (only if they ask)

- SMS urgent cover (paid)
- Deeper analytics / delivery stats
- Tweaks from coordinator feedback

## 4. Go-live

Brevo SMTP, `DEPLOY.md`, privacy notice reviewed by them, seed accounts off in prod,
one backup restore drill.
