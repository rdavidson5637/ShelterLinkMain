-- Per-shelter inactive-volunteer retention (SL-LATER-19).
--   shelter_settings.retention_inactive_months
--     NULL  = off (default). The daily job and admin run skip this shelter.
--     1..120 = anonymise volunteers whose COALESCE(last_login, created_at) is
--              older than that many months, via the existing GDPR erasure path.
--              Approved hour rows stay.
-- Kept on shelter_settings (041) so each shelter can choose its own period.
-- Safe to run more than once. Requires 041_under_18_guardian_consent.pg.sql.
-- Feature branch only. Do not apply to production until the coordinator or
-- keeper runs migrations in order after a backup.
--
-- Rollback:
--   ALTER TABLE shelter_settings
--     DROP CONSTRAINT IF EXISTS shelter_settings_retention_months_chk,
--     DROP COLUMN IF EXISTS retention_inactive_months;

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'shelter_settings'
  ) THEN
    RAISE EXCEPTION 'shelter_settings is missing. Apply 041 first.';
  END IF;
END $$;

ALTER TABLE shelter_settings
  ADD COLUMN IF NOT EXISTS retention_inactive_months SMALLINT DEFAULT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'shelter_settings_retention_months_chk'
  ) THEN
    ALTER TABLE shelter_settings
      ADD CONSTRAINT shelter_settings_retention_months_chk
      CHECK (
        retention_inactive_months IS NULL
        OR (retention_inactive_months >= 1 AND retention_inactive_months <= 120)
      );
  END IF;
END $$;

COMMIT;
