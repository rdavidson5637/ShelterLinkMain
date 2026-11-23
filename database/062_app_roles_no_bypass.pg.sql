-- SL-NOW-06B: run app queries under non-bypass roles so tenant RLS actually
-- applies. The login role (usually postgres) keeps BYPASSRLS and still owns
-- the tables; this migration does not revoke that. The app SET LOCAL ROLE to
-- one of these NOLOGIN NOBYPASSRLS roles inside each transaction:
--
--   shelterlink_app       default / unscoped queries, the session store,
--                         job_runs claims, and rate-limit counters.
--                         No policies on tenant tables, so reads and writes
--                         return no rows or fail even if applyTenant is skipped.
--   shelterlink_platform  explicit runWithoutShelter paths: login, public
--                         pages, platform admin, provisioning.
--   shelterlink_tenant    unchanged: SET LOCAL ROLE plus app.shelter_id.
--
-- No new database password or connection string is required: both roles are
-- granted to postgres and to CURRENT_USER so SET ROLE works for the existing
-- login. Additive and safe to run more than once.
--
-- Rollback:
--   DROP POLICY IF EXISTS platform_unscoped ON <each RLS table>;
--   DROP POLICY IF EXISTS app_session_all ON session;
--   DROP POLICY IF EXISTS app_job_runs_all ON job_runs;
--   DROP POLICY IF EXISTS app_rate_limit_hits_all ON rate_limit_hits;
--   REVOKE ALL ON ALL TABLES IN SCHEMA public FROM shelterlink_app, shelterlink_platform;
--   DROP ROLE IF EXISTS shelterlink_app;
--   DROP ROLE IF EXISTS shelterlink_platform;

CREATE ROLE shelterlink_app NOLOGIN NOBYPASSRLS;
-- @break
CREATE ROLE shelterlink_platform NOLOGIN NOBYPASSRLS;
-- @break

BEGIN;

GRANT shelterlink_app TO CURRENT_USER;
GRANT shelterlink_app TO postgres;
GRANT shelterlink_platform TO CURRENT_USER;
GRANT shelterlink_platform TO postgres;

ALTER ROLE shelterlink_app SET search_path TO public;
ALTER ROLE shelterlink_platform SET search_path TO public;

GRANT USAGE ON SCHEMA public TO shelterlink_app;
GRANT USAGE ON SCHEMA public TO shelterlink_platform;

-- Session store (connect-pg-simple). Create it if the app has not yet, so
-- RLS is in place before the first login.
CREATE TABLE IF NOT EXISTS session (
  sid    varchar NOT NULL,
  sess   json NOT NULL,
  expire timestamp(6) NOT NULL,
  PRIMARY KEY (sid)
);
CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON session (expire);

ALTER TABLE session ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS app_session_all ON session;
CREATE POLICY app_session_all ON session
  FOR ALL
  TO shelterlink_app
  USING (true)
  WITH CHECK (true);

GRANT SELECT, INSERT, UPDATE, DELETE ON session TO shelterlink_app;

-- Unscoped operational tables used without a shelter context (login rate
-- limits, scheduler claims).
DO $$
BEGIN
  IF to_regclass('public.job_runs') IS NOT NULL THEN
    ALTER TABLE job_runs ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS app_job_runs_all ON job_runs;
    CREATE POLICY app_job_runs_all ON job_runs
      FOR ALL
      TO shelterlink_app
      USING (true)
      WITH CHECK (true);
    GRANT SELECT, INSERT, UPDATE, DELETE ON job_runs TO shelterlink_app;
  END IF;
  IF to_regclass('public.rate_limit_hits') IS NOT NULL THEN
    ALTER TABLE rate_limit_hits ENABLE ROW LEVEL SECURITY;
    DROP POLICY IF EXISTS app_rate_limit_hits_all ON rate_limit_hits;
    CREATE POLICY app_rate_limit_hits_all ON rate_limit_hits
      FOR ALL
      TO shelterlink_app
      USING (true)
      WITH CHECK (true);
    GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_hits TO shelterlink_app;
  END IF;
END $$;

-- Platform / login / public / provision: explicit role, not BYPASSRLS.
-- Policies are added only on tables that already have RLS. New tenant
-- tables stay closed to this role until a later migration says otherwise.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO shelterlink_platform;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO shelterlink_platform;
REVOKE ALL ON TABLE schema_migrations FROM shelterlink_platform;
REVOKE ALL ON TABLE schema_migrations FROM shelterlink_app;

GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO shelterlink_platform;


DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.relname AS t
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relrowsecurity
       AND c.relname <> 'schema_migrations'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS platform_unscoped ON %I', r.t);
    EXECUTE format(
      'CREATE POLICY platform_unscoped ON %I FOR ALL TO shelterlink_platform USING (true) WITH CHECK (true)',
      r.t
    );
  END LOOP;
END $$;

COMMIT;
