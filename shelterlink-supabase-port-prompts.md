# ShelterLink - Supabase Postgres port, Cursor prompts

Goal: keep the Express app and its 129 tests, replace MySQL with Supabase Postgres, then deploy. Run these strictly in order - each builds on the last. Run `npm test` after every prompt; it must stay green (the mock DB layer means most tests are dialect-agnostic).

Run this BEFORE the round-3 feature prompts, so new features are built once, on Postgres.

Strategy: an adapter layer in `config/database.js` keeps the mysql2-shaped interface (`pool.execute(sql, params)` returning `[rows]`, `insertId` on writes) so the 20+ models barely change. Dialect fixes happen in the SQL strings, not the architecture.

Prerequisites (you, 10 min): create a free Supabase project at supabase.com, note the connection string (Session pooler URI, port 5432), keep the database password somewhere safe. For local dev, install Postgres (`brew install postgresql@16`) or just develop straight against Supabase.

---

## Prompt P1 - Postgres adapter with a mysql2-compatible interface

```
Port this Express app's database layer from mysql2 to node-postgres (pg) WITHOUT changing the interface the models depend on. Models call `const { pool } = require('../config/database')` and use `pool.execute(sql, params)` expecting mysql2 shapes.

1. Add pg to dependencies, remove nothing yet (mysql2 stays until the port completes).
2. Rewrite config/database.js on pg.Pool with these compatibility behaviours:
   - execute(sql, params) and query(sql, params): translate mysql-style ? placeholders to $1..$n (respect quoted strings so a literal '?' inside quotes is not translated), run the query, and return [rows] like mysql2 (rows array for SELECT).
   - For INSERT statements: automatically append RETURNING * when no RETURNING is present, and expose result.insertId mapped from the first returned row's primary key (first column ending in _id or named id), plus result.affectedRows from rowCount.
   - For UPDATE/DELETE: return { affectedRows: rowCount }.
   - getConnection(): return a client wrapper with beginTransaction/commit/rollback/execute/query/release matching what models/SwapRequest and others use today.
3. Connection config from env: prefer DATABASE_URL (Supabase session pooler URI) with ssl { rejectUnauthorized: false } when the host is not localhost; fall back to discrete DB_* vars for local Postgres.
4. Keep testConnection() with a SELECT 1 health check and the same concise error logging.
5. Do not modify any model in this prompt. The unit tests use test/helpers/mockDb.js which replaces this module entirely, so npm test must still pass unchanged.
6. Add a unit test for the placeholder translator (?, quoted '?', multiple params) and the insertId mapping, testing the pure functions directly.
```

---

## Prompt P2 - Postgres schema and seed

```
Convert this app's MySQL schema to Postgres. Source of truth: database/schema.sql (MySQL, tables users, opportunities, volunteer_profiles, applications, volunteer_hours, sessions, job_runs, admin_messages, qualifications, volunteer_qualifications, opportunity_qualifications, custom_fields, custom_field_values, waivers, waiver_acceptances, user_documents, tags, volunteer_tags, opportunity_tags, match digest queue, swap_requests, audit_log, shift_feedback, group_bookings).

1. Create database/schema.pg.sql with the full converted schema:
   - AUTO_INCREMENT -> GENERATED ALWAYS AS IDENTITY
   - Backticks -> unquoted lowercase identifiers
   - TINYINT(1) flags -> SMALLINT keeping 0/1 semantics (do NOT convert to boolean; the JS compares against 0/1 everywhere)
   - ENUM columns -> TEXT with CHECK constraints listing the same values (easier to extend than Postgres enums)
   - DATETIME -> TIMESTAMP (no timezone; the app stores and compares 'YYYY-MM-DD HH:MM:SS' strings and the pg driver should return strings: set the pg type parsers so DATE and TIMESTAMP come back as strings, matching mysql2's dateStrings:true behaviour - put that in config/database.js)
   - ON UPDATE CURRENT_TIMESTAMP -> trigger function set_updated_at() applied to the tables that had it
   - MEDIUMTEXT/TEXT -> TEXT; DECIMAL stays; utf8mb4/ENGINE clauses dropped
   - Recreate every index from the MySQL schema including the 018 composite indexes; same names
   - Skip the old MySQL sessions table: session storage is replaced in P4
2. Convert database/seed.sql to database/seed.pg.sql (same accounts and sample data; keep bcrypt hashes as-is).
3. Rewrite scripts/setup-db.js to run against Postgres via the new config/database.js (drop schema objects and recreate for reset; keep --seed/--no-seed flags and the same console output).
4. Rewrite scripts/migrate.js for Postgres (same schema_migrations tracking; it will apply future NNN_*.pg.sql files).
5. Keep the MySQL files in place for reference; new files use the .pg.sql suffix.
6. Verify: node scripts/setup-db.js --seed runs cleanly against a local Postgres or the Supabase DATABASE_URL.
```

---

## Prompt P3 - Model SQL dialect pass

```
Sweep every SQL string in models/, controllers/, and jobs/ of this Express app for MySQL-isms and convert to Postgres. The adapter already handles ? placeholders and insertId, so ONLY fix dialect inside the SQL text. Go file by file and keep npm test green throughout (tests assert against the SQL strings; update a test only when its assertion encodes MySQL syntax).

Known spots to fix (search for each pattern everywhere):
1. DATE_ADD(?, INTERVAL 24 HOUR) -> (?::timestamp + interval '24 hours') - in Application.findAcceptedNeedingReminder and anywhere else DATE_ADD/DATE_SUB appears.
2. MONTH(date), YEAR(date) -> EXTRACT(MONTH FROM date)::int, EXTRACT(YEAR FROM date)::int - statsController monthly chart and anywhere else.
3. NOW() works in both; CURDATE() -> CURRENT_DATE.
4. Backticked identifiers in queries (e.g. buildUpdateSetClause in models/Opportunity.js wraps column names in backticks) -> double quotes or bare lowercase names.
5. ON DUPLICATE KEY UPDATE -> INSERT ... ON CONFLICT (cols) DO UPDATE SET - check AdminMessage, match digest queue, waiver acceptance, schema_migrations writes.
6. LAST_INSERT_ID() if present -> rely on the adapter's insertId.
7. LIMIT x is fine; LIMIT x OFFSET y is fine.
8. Any GROUP BY that selects non-aggregated columns not in the GROUP BY (MySQL tolerates, Postgres errors) - statsController and export queries are the likely offenders; add the columns or aggregate them.
9. CONCAT works; string || string also fine. IFNULL -> COALESCE.
10. Boolean-ish comparisons stay numeric (approved = 1) since flags are SMALLINT.

Then run the full suite and fix any test whose regex asserts backticks or MySQL functions. Finish with a grep proving no DATE_ADD, ON DUPLICATE, IFNULL, CURDATE, or backtick remains in models/, controllers/, jobs/.
```

---

## Prompt P4 - Sessions and remaining infrastructure

```
Finish the Postgres port of this Express app's infrastructure.

1. Replace express-mysql-session with connect-pg-simple in server.js, using the pg pool from config/database.js. Auto-create its session table on boot. Keep cookie settings (httpOnly, sameSite, maxAge) exactly as they are. Kiosk mode and role flags live in req.session and must keep working - no behaviour change.
2. create-admin.js: verify it works through the adapter (it should; fix any direct mysql2 usage).
3. utils/jobLog.js and all jobs/: verify inserts work through the adapter's insertId mapping.
4. Remove mysql2 and express-mysql-session from package.json dependencies. Full grep for require('mysql2') anywhere - only config/database.js history should have had it, and it is now pg-only.
5. Update .env.example: DATABASE_URL (Supabase session pooler URI, with a comment showing the format and that sslmode is handled in code), keep discrete DB_* vars documented for local Postgres, delete MAMP references.
6. npm test green, and node scripts/smoke-test.js passes against a locally running server pointed at Postgres (npm run db:reset, npm run dev, npm run smoke).
```

---

## Prompt P5 - Supabase specifics and ops hardening

```
Wire this Express app (now on pg) to Supabase and make it production-safe.

1. Connection: document and default to the Supabase SESSION pooler URI (port 5432) in .env.example - transaction pooler (6543) breaks connect-pg-simple LISTEN-free but also prepared statements; session mode is required. Pool max 10 (Supabase free tier connection budget), idle timeout 30s.
2. Keep-alive: Supabase free tier pauses after ~7 days of inactivity. Add a tiny scheduled job (uses utils/scheduler.js) that runs SELECT 1 daily and records to job_runs, so app uptime keeps the DB awake. Note in the README that the app host must be always-on.
3. Backups: add scripts/backup.js that runs pg_dump via DATABASE_URL to backups/shelterlink-YYYY-MM-DD.sql.gz and prunes files older than 14 days; add npm run backup and a note to cron it on the host. backups/ gitignored.
4. Graceful shutdown: SIGTERM closes the HTTP server, stops the scheduler, ends the pg pool.
5. Health endpoint GET /healthz (no auth): returns 200 with { db: true } after a fast SELECT 1, 503 otherwise - for the host's health checks and UptimeRobot.
6. Trust proxy: app.set('trust proxy', 1) so secure cookies and express-rate-limit work behind the host's proxy; make session cookie secure:true when NODE_ENV=production.
7. npm test green; smoke test against the real Supabase DATABASE_URL passes.
```

---

## Prompt P6 - Deploy

```
Prepare this Express app for deployment on Railway (or Render - keep it host-agnostic).

1. Ensure PORT comes from env (it does), NODE_ENV=production behaviour reviewed: helmet CSP on, rate limits on, error handler hides stack traces, morgan-style logging minimal.
2. Add a Dockerfile: node:22-alpine, npm ci --omit=dev, non-root user, EXPOSE, CMD node server.js. And a .dockerignore (node_modules, backups, storage/uploads, .env, .git).
3. Uploads: storage/uploads is ephemeral on most hosts. Add UPLOAD_DIR support verification (already env-driven) and README guidance: mount a persistent volume at the host for it (Railway volume / Render disk).
4. Document the deploy in DEPLOY.md: create Supabase project, run node scripts/setup-db.js --no-seed with DATABASE_URL, deploy on Railway with env vars (DATABASE_URL, SESSION_SECRET, ADMIN_REGISTRATION_KEY, FEEDBACK_TOKEN_SECRET, APP_URL, EMAIL_*), attach volume for uploads, set the cron for npm run backup, point UptimeRobot at /healthz, create the first admin with npm run create-admin.
5. Production checklist section in DEPLOY.md: fresh secrets, HTTPS (host-provided), EMAIL_* filled with Brevo SMTP, DATA_RETENTION_YEARS confirmed, first real admin created and seed accounts absent (setup ran --no-seed).
```

---

## After the port

Run the round-3 feature prompts (18-25) on the Postgres codebase - they are dialect-light, but tell Cursor at the top of each: "This app now runs on Postgres via pg with a mysql2-compatible adapter; write Postgres SQL and .pg.sql migrations."

Total realistic effort: P1-P3 are the meat (a focused day or two with Cursor), P4-P6 an evening each.
