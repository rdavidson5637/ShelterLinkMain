-- Rate-limit store + job-run claim keys for multi-replica safety (SL-LATER-04).
--
-- express-rate-limit defaults to an in-process MemoryStore. With more than one
-- app instance that under-counts. rate_limit_hits is a shared counter table.
--
-- The in-process scheduler only dedupes within one process. job_runs.run_key
-- lets a replica claim a cron minute before running so the same job does not
-- fire twice across instances.
--
-- session, job_runs, schema_migrations, and rate_limit_hits stay global
-- (no shelter_id). Safe to run more than once.
-- Feature branch only. Do not apply to production until the coordinator or
-- keeper runs migrations in order after a backup.
--
-- Rollback:
--   DROP TABLE IF EXISTS rate_limit_hits;
--   DROP INDEX IF EXISTS uq_job_runs_name_run_key;
--   ALTER TABLE job_runs DROP COLUMN IF EXISTS run_key;

BEGIN;

CREATE TABLE IF NOT EXISTS rate_limit_hits (
  key       TEXT          PRIMARY KEY,
  hits      INTEGER       NOT NULL DEFAULT 0 CHECK (hits >= 0),
  reset_at  TIMESTAMPTZ   NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_rate_limit_hits_reset
  ON rate_limit_hits (reset_at);

ALTER TABLE job_runs
  ADD COLUMN IF NOT EXISTS run_key VARCHAR(64) DEFAULT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_job_runs_name_run_key
  ON job_runs (job_name, run_key)
  WHERE run_key IS NOT NULL;

-- Tenant role may write these while a request or scheduled job is switched
-- into shelterlink_tenant. Same pattern as job_runs_tenant_log in 033.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shelterlink_tenant') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON rate_limit_hits TO shelterlink_tenant;
  END IF;
END $$;

DROP POLICY IF EXISTS rate_limit_hits_tenant_log ON rate_limit_hits;
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'shelterlink_tenant') THEN
    ALTER TABLE rate_limit_hits ENABLE ROW LEVEL SECURITY;
    CREATE POLICY rate_limit_hits_tenant_log ON rate_limit_hits
      FOR ALL
      TO shelterlink_tenant
      USING (true)
      WITH CHECK (true);
  END IF;
END $$;

COMMIT;
