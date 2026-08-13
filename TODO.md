# ShelterLink - what's left, in order

Direction: production platform for real shelters, not a uni submission. Database is being ported to Supabase Postgres (see shelterlink-supabase-port-prompts.md), app stays Express and deploys to an always-on host.

Work through this top to bottom. Steps 1-3 verify the MySQL baseline before the port so you know any breakage is the port's fault, not pre-existing.

## 1. First run on MAMP (15 min)

1. Open MAMP, press Start (MySQL must be on port 8889).
2. Terminal:
   ```bash
   cd ~/Desktop/Projects/ShelterLink/"shelterlink cursor"
   npm install
   npm run db:reset
   npm run dev
   ```
3. Open http://localhost:3000 and log in:
   - Admin: admin@shelterlink.org / Admin123!
   - Volunteer: alex.jenkins@example.com / Password1

`.env` is already configured (MAMP defaults, generated secrets, email off so links print to the server console).

## 2. Automated checks (5 min)

With `npm run dev` still running, in a second terminal:

```bash
npm test        # expect 129 passing
npm run smoke   # full-stack pass against the live server, expect all steps green
```

If either fails, copy the output and paste it to Claude.

## 3. Manual click-through (10 min)

The "Quick manual pass" section in RUN-ON-MAMP.md: create a recurring shift, waitlist a full shift, check in with a code, open every admin page, try the kiosk at /kiosk, confirm a staff account can't see admin-only pages.

## 4. Cursor: Supabase port (P1-P6)

Create a free Supabase project first (supabase.com, note the Session pooler connection string and DB password). Then paste the prompts from shelterlink-supabase-port-prompts.md strictly in order P1 to P6. `npm test` after every prompt, commit after every prompt. P1-P3 are the big ones; P4-P6 are an evening each.

## 5. Cursor: round 3 feature prompts

After the port, run shelterlink-cursor-prompts-round3.md prompts 18-25, nav prompt 18 first. Prefix each with: "This app now runs on Postgres via pg; write Postgres SQL and .pg.sql migrations." `npm test` and click-test after each.

## 6. Email (when you want real sends)

1. Free Brevo account (300 emails/day) or Mailgun.
2. Put its SMTP host, port, user, password into EMAIL_* in `.env`.
3. Restart the server, trigger a password reset to test.

## 7. Deploy (P6 produces DEPLOY.md with the detail)

Railway or Render for the app (always-on, needed for the scheduler), Supabase for the DB, persistent volume for uploads, UptimeRobot on /healthz, cron for npm run backup. Fresh production secrets, HTTPS via the host, setup ran --no-seed so no demo accounts exist.

## 8. Before a real shelter uses it

- Privacy notice: what's stored, retention (3 years per DATA_RETENTION_YEARS), how to request erasure
- Decide who gets role admin vs staff at the shelter
- Test a backup restore once
- Walk one real shelter person through the flows and watch where they get stuck

## 9. Docs (last)

- Update README.md: Postgres/Supabase setup, roles, kiosk, scheduler jobs, migrate/backup scripts
- One-page staff guide and one-page volunteer guide (Claude can draft both from the codebase when ready)
